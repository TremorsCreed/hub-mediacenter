import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { isConnected, mediaStates, getPendingAutoplay, lastCatalog } from '../ws'
import { isValidAdminToken } from '../auth'
import { getXtreamCred, xtreamCall } from './iptv'
import { normalizeTitle, findIptvVodMatch, getSeriesList } from '../iptvVodCache'

// Deux titres désignent-ils le même média ? (normalisés : minuscules, sans préfixe de
// langue ni ponctuation). Égalité, ou inclusion si assez long (évite les faux positifs).
function titleMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const na = normalizeTitle(a), nb = normalizeTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return (na.includes(nb) && nb.length >= 6) || (nb.includes(na) && na.length >= 6)
}

// Cache (par device) de la miniature résolue par titre, pour ne pas relancer une
// recherche VOD à chaque poll (1,5s) tant que le titre joué ne change pas.
const nowThumbCache = new Map<string, { title: string; thumb?: string }>()
const IPTV_PLAYERS = ['justplayer', 'vlc', 'mxplayer', 'iptv', 'tivimate']

async function resolveCredId(deviceId: string): Promise<number | null> {
  const { rows: dc } = await db.execute({ sql: 'SELECT xtream_credential_id FROM device_config WHERE device_id = ?', args: [deviceId] })
  let credId = (dc[0] as any)?.xtream_credential_id
  if (!credId) {
    const { rows: a } = await db.execute("SELECT id FROM credentials WHERE type='xtream' ORDER BY id LIMIT 1")
    credId = (a[0] as any)?.id
  }
  return credId ? Number(credId) : null
}

const router = Router()

// GET /now/:deviceId — état de lecture temps réel (barre « lecture en cours »).
// null si rien ne joue. La position est un instantané + updated_at pour que le
// client l'extrapole pendant la lecture. On enrichit avec la miniature : l'art de
// la MediaSession (poussé par l'agent) en priorité, sinon le thumb persisté par
// /play (cas Just Player/IPTV où la session n'expose pas de pochette).
router.get('/now/:deviceId', async (req, res) => {
  const m = mediaStates.get(req.params.deviceId)
  if (!m) {
    // Rien ne joue : si un autoplay est armé, on renvoie l'état « entre deux épisodes »
    // pour que la barre du Hub affiche le compte à rebours (titre + échéance).
    const pending = getPendingAutoplay(req.params.deviceId)
    if (pending) return res.json({ state: 'between', position: 0, duration: 0, seekable: false, updated_at: Date.now(), up_next: pending })
    return res.json(null)
  }
  // Miniature : art MediaSession d'abord ; sinon le thumb du lancement (lastCatalog,
  // puis playback_state) MAIS seulement si son titre correspond à ce qui joue — sinon
  // on laisserait le poster d'un film précédent (Just Player ne rafraîchit pas son art).
  let thumb = m.art
  if (!thumb) {
    const lc = lastCatalog.get(req.params.deviceId)
    if (lc && titleMatch(lc.title, m.title)) thumb = lc.thumb
  }
  if (!thumb) {
    const { rows } = await db.execute({
      sql: 'SELECT thumb, title FROM playback_state WHERE device_id = ?',
      args: [req.params.deviceId],
    })
    const ps = rows[0] as any | undefined
    if (ps?.thumb && titleMatch(ps.title, m.title)) thumb = ps.thumb as string
  }
  // Lancé hors Hub (télécommande) sur un lecteur IPTV : pas de thumb connu → on le
  // retrouve par titre dans le catalogue VOD (cache par device pour éviter le spam).
  if (!thumb && m.title && IPTV_PLAYERS.includes(m.app || '')) {
    const cached = nowThumbCache.get(req.params.deviceId)
    if (cached && cached.title === m.title) {
      thumb = cached.thumb
    } else {
      const credId = await resolveCredId(req.params.deviceId)
      if (credId) {
        const img = (logo?: string) => logo ? `/api/iptv/image?url=${encodeURIComponent(logo)}` : undefined
        // 1) film VOD par titre
        const vod = await findIptvVodMatch(credId, m.title).catch(() => null)
        thumb = img(vod?.logo)
        // 2) sinon série : extraire le nom (avant « SxxExx ») et chercher la série
        if (!thumb) {
          const sm = m.title.match(/^(.*?)\s*[-–]\s*s\d{1,2}\s*e\d{1,3}/i)
          if (sm) {
            const n = normalizeTitle(sm[1])
            const list = await getSeriesList(credId).catch(() => [])
            const hit = list.find(s => {
              const sn = normalizeTitle(s.name)
              return sn === n || (sn.includes(n) && n.length >= 6) || (n.includes(sn) && sn.length >= 6)
            })
            thumb = img(hit?.logo)
          }
        }
      }
      nowThumbCache.set(req.params.deviceId, { title: m.title, thumb })
    }
  }
  res.json({ ...m, thumb })
})

// GET /progress — « Reprendre » (continue watching) : médias en cours, ni à peine
// commencés ni quasi terminés, triés par récence. Fournit les identifiants de reprise
// (plex/iptv) + la position pour relancer à la bonne seconde. Progression globale en v1
// (pas de scoping par profil — viendra avec la session active par device).
router.get('/progress', async (req, res) => {
  // ?all=1 : relâche le plancher (un film à peine entamé compte aussi) et élargit la
  // fenêtre — utilisé pour « reprendre une playlist » où même 1 min comptée doit reprendre.
  const all = req.query.all === '1'
  const lowBound = all ? 'position > 30000' : 'position > duration * 0.02'
  const highBound = all ? 'position < duration * 0.98' : 'position < duration * 0.95'
  const limit = all ? 200 : 24
  const { rows } = await db.execute(`
    SELECT media_key, catalog_id, app, title, thumb, plex_id, iptv_stream_id, iptv_type, iptv_ext,
           position, duration, updated_at
    FROM playback_progress
    WHERE seekable = 1 AND duration > 0
      AND ${lowBound} AND ${highBound}
      AND iptv_type IS NOT 'live'
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `)
  res.json(rows.map((r: any) => ({
    ...r,
    percent: r.duration > 0 ? Math.min(100, Math.round((r.position / r.duration) * 100)) : 0,
  })))
})

// GET /now-meta/:deviceId — métadonnées étendues du média en cours (synopsis, genre,
// casting…) résolues depuis la source (Plex ou IPTV VOD) via le catalog_id persisté.
// null si rien d'exploitable (live, série IPTV par épisode, etc.).
router.get('/now-meta/:deviceId', async (req, res) => {
  const deviceId = req.params.deviceId
  // On ne renvoie des infos que pour CE qui joue réellement (mediaStates) ET seulement
  // si on sait à quel média source ça correspond (titre vérifié) → jamais d'info périmée.
  const cur = mediaStates.get(deviceId)
  if (!cur || cur.state === 'stopped') return res.json(null)
  const curTitle = cur.title

  let catId: string | undefined
  // 1) Dernier lancement Hub, si le titre correspond à ce qui joue.
  const lc = lastCatalog.get(deviceId)
  if (lc && titleMatch(lc.title, curTitle)) catId = lc.catalog_id
  // 2) playback_state (titre vérifié aussi).
  if (!catId) {
    const { rows } = await db.execute({ sql: 'SELECT catalog_id, title FROM playback_state WHERE device_id = ?', args: [deviceId] })
    const ps = rows[0] as any | undefined
    if (ps?.catalog_id && titleMatch(ps.title, curTitle)) catId = ps.catalog_id as string
  }
  // 3) Lancé hors Hub (télécommande physique…) : retrouver le média IPTV VOD par son
  //    titre via le cache (Plex hors Hub non couvert ici).
  if (!catId && curTitle && ['justplayer', 'vlc', 'mxplayer', 'iptv', 'tivimate'].includes(cur.app || '')) {
    const credId = await resolveCredId(deviceId)
    if (credId) {
      const m = await findIptvVodMatch(credId, curTitle).catch(() => null)
      if (m && (m as any).stream_id) catId = `iptv:vod:${(m as any).stream_id}`
    }
  }
  if (!catId) return res.json(null)
  try {
    if (catId.startsWith('plex:')) {
      const rk = catId.slice(5)
      const { rows: pc } = await db.execute('SELECT auth_token, server_url FROM plex_config WHERE id = 1')
      const cfg = pc[0] as any
      if (!cfg?.auth_token || !cfg?.server_url) return res.json(null)
      const r = await fetch(`${cfg.server_url}/library/metadata/${rk}?X-Plex-Token=${cfg.auth_token}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) as any })
      if (!r.ok) return res.json(null)
      const d: any = await r.json()
      const m = d?.MediaContainer?.Metadata?.[0]
      if (!m) return res.json(null)
      const tags = (arr: any[]) => (arr ?? []).map((x: any) => x.tag).filter(Boolean)
      return res.json({
        source: 'plex',
        plot: m.summary || undefined,
        genre: tags(m.Genre).slice(0, 4).join(', ') || undefined,
        cast: tags(m.Role).slice(0, 5).join(', ') || undefined,
        director: tags(m.Director).join(', ') || undefined,
        year: m.year || undefined,
        rating: m.rating || undefined,
      })
    }
    const mv = catId.match(/^iptv:vod:(.+)$/)
    if (mv) {
      const { rows: dc } = await db.execute({ sql: 'SELECT xtream_credential_id FROM device_config WHERE device_id = ?', args: [req.params.deviceId] })
      let credId = (dc[0] as any)?.xtream_credential_id
      if (!credId) {
        const { rows: any1 } = await db.execute("SELECT id FROM credentials WHERE type='xtream' ORDER BY id LIMIT 1")
        credId = (any1[0] as any)?.id
      }
      if (!credId) return res.json(null)
      const cred = await getXtreamCred(String(credId))
      if (!cred) return res.json(null)
      const d: any = await xtreamCall(cred, 'get_vod_info', { vod_id: mv[1] })
      const info = d?.info || {}
      return res.json({
        source: 'iptv',
        plot: info.plot || info.description || undefined,
        genre: info.genre || undefined,
        cast: info.cast || info.actors || undefined,
        director: info.director || undefined,
        year: String(info.releasedate || info.release_date || '').slice(0, 4) || undefined,
        rating: info.rating || undefined,
      })
    }
    return res.json(null)
  } catch { return res.json(null) }
})

// DELETE /progress?key=<media_key> — retire une entrée de « Reprendre » (bouton ✕).
router.delete('/progress', async (req, res) => {
  const key = req.query.key as string | undefined
  if (!key) return res.status(400).json({ error: 'key requis' })
  await db.execute({ sql: 'DELETE FROM playback_progress WHERE media_key = ?', args: [key] })
  res.json({ ok: true })
})

router.get('/', async (_req, res) => {
  // Title : prefer playback_state.title (rempli pour les plays directs Plex/IPTV),
  // fallback sur catalog.title pour les plays via entrée catalog.
  const { rows } = await db.execute(`
    SELECT ps.device_id, ps.catalog_id, ps.app, ps.status, ps.started_at,
           d.name as device_name,
           COALESCE(ps.title, c.title) as title
    FROM playback_state ps
    LEFT JOIN devices d ON d.id = ps.device_id
    LEFT JOIN catalog c ON c.id = ps.catalog_id
    ORDER BY d.name
  `)
  res.json(rows.map((r: any) => ({ ...r, ws_connected: isConnected(r.device_id) })))
})

// GET /history — un membre ne voit que son propre historique ; l'admin (token
// valide) voit tout et peut filtrer via ?user_id=<id> (ou ?user_id=all).
router.get('/history', async (req, res) => {
  const isAdmin = isValidAdminToken(req.header('X-Admin-Token') ?? undefined)
  const userId = (req as any).userId as number | null
  const filter = req.query.user_id as string | undefined

  let where = ''
  const args: any[] = []
  if (isAdmin) {
    if (filter && filter !== 'all') { where = 'WHERE h.user_id = ?'; args.push(Number(filter)) }
  } else {
    if (userId == null) return res.json([]) // aucun profil sélectionné
    where = 'WHERE h.user_id = ?'; args.push(userId)
  }

  const { rows } = await db.execute({
    sql: `
      SELECT h.*, d.name as device_name, u.name as user_name, u.avatar_color as user_color
      FROM playback_history h
      LEFT JOIN devices d ON d.id = h.device_id
      LEFT JOIN users u ON u.id = h.user_id
      ${where}
      ORDER BY h.started_at DESC LIMIT 200
    `,
    args,
  })
  res.json(rows)
})

// DELETE /history/:id — supprime une entrée (la sienne, ou n'importe laquelle si admin).
router.delete('/history/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const isAdmin = isValidAdminToken(req.header('X-Admin-Token') ?? undefined)
  const userId = (req as any).userId as number | null

  if (isAdmin) {
    await db.execute({ sql: 'DELETE FROM playback_history WHERE id = ?', args: [id] })
  } else {
    if (userId == null) return res.status(403).json({ error: 'no_profile' })
    await db.execute({ sql: 'DELETE FROM playback_history WHERE id = ? AND user_id = ?', args: [id, userId] })
  }
  res.json({ ok: true })
})

// DELETE /history — efface tout l'historique du profil courant. L'admin peut
// cibler ?user_id=<id> ou ?user_id=all (tout purger).
router.delete('/history', async (req, res) => {
  const isAdmin = isValidAdminToken(req.header('X-Admin-Token') ?? undefined)
  const userId = (req as any).userId as number | null
  const filter = req.query.user_id as string | undefined

  if (isAdmin) {
    if (filter === 'all') await db.execute('DELETE FROM playback_history')
    else if (filter) await db.execute({ sql: 'DELETE FROM playback_history WHERE user_id = ?', args: [Number(filter)] })
    else if (userId != null) await db.execute({ sql: 'DELETE FROM playback_history WHERE user_id = ?', args: [userId] })
  } else {
    if (userId == null) return res.status(403).json({ error: 'no_profile' })
    await db.execute({ sql: 'DELETE FROM playback_history WHERE user_id = ?', args: [userId] })
  }
  res.json({ ok: true })
})

// GET /played — identifiants (catalog_id = entry.id) déjà lancés par le profil
// courant. Sert à marquer les items « vus » dans une playlist (pastille verte).
router.get('/played', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.json([])
  const { rows } = await db.execute({
    sql: 'SELECT DISTINCT catalog_id FROM playback_history WHERE user_id = ? AND catalog_id IS NOT NULL',
    args: [userId],
  })
  res.json(rows.map((r: any) => r.catalog_id))
})

router.get('/:device_id', async (req, res) => {
  const { rows } = await db.execute({
    sql: `SELECT ps.*, d.name as device_name, c.title
          FROM playback_state ps
          LEFT JOIN devices d ON d.id = ps.device_id
          LEFT JOIN catalog c ON c.id = ps.catalog_id
          WHERE ps.device_id = ?`,
    args: [req.params.device_id]
  })
  if (!rows.length) return res.status(404).json({ error: 'device not found' })
  const r = rows[0] as any
  res.json({ ...r, ws_connected: isConnected(r.device_id) })
})

const StateUpdateSchema = z.object({
  status: z.enum(['playing', 'paused', 'stopped', 'error']),
  catalog_id: z.string().optional(),
  app: z.string().optional()
})

router.post('/:device_id', async (req, res) => {
  const parsed = StateUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { status, catalog_id, app } = parsed.data
  await db.execute({
    sql: `UPDATE playback_state SET status = ?, catalog_id = ?, app = ?, started_at = ? WHERE device_id = ?`,
    args: [status, catalog_id ?? null, app ?? null, status === 'playing' ? Date.now() : null, req.params.device_id]
  })
  res.json({ ok: true })
})

export default router
