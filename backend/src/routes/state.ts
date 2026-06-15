import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { isConnected, mediaStates, getPendingAutoplay } from '../ws'
import { isValidAdminToken } from '../auth'
import { getXtreamCred, xtreamCall } from './iptv'

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
  let thumb = m.art
  if (!thumb) {
    const { rows } = await db.execute({
      sql: 'SELECT thumb FROM playback_state WHERE device_id = ?',
      args: [req.params.deviceId],
    })
    thumb = ((rows[0] as any)?.thumb as string) || undefined
  }
  res.json({ ...m, thumb })
})

// GET /progress — « Reprendre » (continue watching) : médias en cours, ni à peine
// commencés ni quasi terminés, triés par récence. Fournit les identifiants de reprise
// (plex/iptv) + la position pour relancer à la bonne seconde. Progression globale en v1
// (pas de scoping par profil — viendra avec la session active par device).
router.get('/progress', async (_req, res) => {
  const { rows } = await db.execute(`
    SELECT media_key, catalog_id, app, title, thumb, plex_id, iptv_stream_id, iptv_type, iptv_ext,
           position, duration, updated_at
    FROM playback_progress
    WHERE seekable = 1 AND duration > 0
      AND position > duration * 0.02 AND position < duration * 0.95
      AND iptv_type IS NOT 'live'
    ORDER BY updated_at DESC
    LIMIT 24
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
  const { rows } = await db.execute({ sql: 'SELECT catalog_id FROM playback_state WHERE device_id = ?', args: [req.params.deviceId] })
  const catId = (rows[0] as any)?.catalog_id as string | undefined
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
