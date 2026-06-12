import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { requireAdmin } from '../auth'
import { getList, normalizeTitle } from '../iptvVodCache'
import { warmImages } from '../iptvImageWarmer'
import { isDead, markDead } from '../imageNegCache'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const router = Router()

async function getXtreamCred(id: string) {
  const { rows } = await db.execute({ sql: 'SELECT data FROM credentials WHERE id = ? AND type = ?', args: [id, 'xtream'] })
  if (!rows.length) return null
  const data = JSON.parse((rows[0] as any).data as string)
  if (!data.server || !data.user || !data.pass) return null
  return {
    server: String(data.server).replace(/\/+$/, '').trim(),
    user: String(data.user).trim(),
    pass: String(data.pass).trim(),
    ext: String(data.ext ?? 'ts').trim(),
  }
}

async function xtreamCall(cred: NonNullable<Awaited<ReturnType<typeof getXtreamCred>>>, action: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ username: cred.user, password: cred.pass, action, ...extra })
  const url = `${cred.server}/player_api.php?${params}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`xtream ${action} failed: ${r.status}`)
  return r.json()
}

// ── EPG (guide) ──────────────────────────────────────────────────────────────
interface EpgEntry { id: string; start_ts: number; stop_ts: number; title: string; desc: string }
const epgCache = new Map<string, { ts: number; listings: EpgEntry[] }>()
const EPG_TTL = 60 * 60 * 1000 // 60 min (l'EPG futur est stable ; le passé est passé)

function b64(s: any): string {
  try { return Buffer.from(String(s ?? ''), 'base64').toString('utf-8') } catch { return String(s ?? '') }
}

function parseEpg(raw: any[]): EpgEntry[] {
  return (raw ?? []).map((e: any) => ({
    id: String(e.id ?? ''),
    start_ts: Number(e.start_timestamp) || Math.floor(Date.parse(e.start) / 1000) || 0,
    stop_ts: Number(e.stop_timestamp) || Number(e.end_timestamp) || Math.floor(Date.parse(e.end) / 1000) || 0,
    title: b64(e.title),
    desc: b64(e.description),
  }))
    .filter((e: EpgEntry) => e.start_ts > 0 && e.stop_ts > e.start_ts)
    .sort((a: EpgEntry, b: EpgEntry) => a.start_ts - b.start_ts)
}

async function getEpg(cred: NonNullable<Awaited<ReturnType<typeof getXtreamCred>>>, credId: string, streamId: string): Promise<EpgEntry[]> {
  const key = `${credId}:${streamId}`
  const c = epgCache.get(key)
  if (c && Date.now() - c.ts < EPG_TTL) return c.listings
  const data: any = await xtreamCall(cred, 'get_simple_data_table', { stream_id: String(streamId) })
  const listings = parseEpg(data?.epg_listings ?? [])
  epgCache.set(key, { ts: Date.now(), listings })
  return listings
}

// POST /api/iptv/:credId/epg/batch  { stream_ids: string[] } → { [streamId]: EpgEntry[] }
router.post('/:credId/epg/batch', async (req, res) => {
  const cred = await getXtreamCred(req.params.credId)
  if (!cred) return res.status(404).json({ error: 'credential not found or incomplete' })
  const ids: string[] = Array.isArray(req.body?.stream_ids) ? req.body.stream_ids.map(String).slice(0, 120) : []
  const out: Record<string, EpgEntry[]> = {}
  let i = 0
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++]
      try { out[id] = await getEpg(cred, req.params.credId, id) } catch { out[id] = [] }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, ids.length || 1) }, worker))
  res.json(out)
})

// GET /api/iptv/:credId/epg/:streamId → EpgEntry[]
router.get('/:credId/epg/:streamId', async (req, res) => {
  const cred = await getXtreamCred(req.params.credId)
  if (!cred) return res.status(404).json({ error: 'credential not found or incomplete' })
  try {
    res.json(await getEpg(cred, req.params.credId, req.params.streamId))
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// ── Rappels EPG (par profil) ─────────────────────────────────────────────────
// GET liste les rappels à venir du profil courant
router.get('/reminders', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.json([])
  const now = Math.floor(Date.now() / 1000)
  const { rows } = await db.execute({
    sql: 'SELECT * FROM epg_reminders WHERE user_id = ? AND start_ts > ? ORDER BY start_ts',
    args: [userId, now - 3600],
  })
  res.json(rows)
})

router.post('/reminders', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const b = req.body ?? {}
  if (!b.stream_id || !b.start_ts) return res.status(400).json({ error: 'stream_id et start_ts requis' })
  const { rows } = await db.execute({
    sql: `INSERT INTO epg_reminders (user_id, cred_id, stream_id, channel_name, title, start_ts, device_id, lead_min, logo, notified, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?) RETURNING id`,
    args: [userId, b.cred_id ?? null, String(b.stream_id), b.channel_name ?? null, b.title ?? null, Number(b.start_ts), b.device_id ?? null, Number(b.lead_min ?? 5), b.logo ?? null, Date.now()],
  })
  res.json({ ok: true, id: (rows[0] as any).id })
})

router.delete('/reminders/:id', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  await db.execute({ sql: 'DELETE FROM epg_reminders WHERE id = ? AND user_id = ?', args: [parseInt(req.params.id, 10), userId] })
  res.json({ ok: true })
})

// GET /api/iptv/credentials
router.get('/credentials', async (_req, res) => {
  const { rows } = await db.execute("SELECT id, name FROM credentials WHERE type = 'xtream' ORDER BY name")
  res.json(rows.map((r: any) => ({ id: r.id, name: r.name })))
})

// ── Préférences de catégories : masquer (déclutter) / verrouiller (parental) ──
type CatState = 'hidden' | 'locked' | 'visible'
type CatRestriction = 'hidden' | 'locked'

// État effectif pour un profil : la base 'global' s'applique partout, et la
// surcharge profil la REMPLACE catégorie par catégorie — 'visible' ré-affiche
// un groupe masqué/verrouillé globalement, 'hidden'/'locked' restreint plus.
// Sans surcharge, le profil hérite du global.
async function getEffectiveCatPrefs(credId: number, type: string, userId: number | null): Promise<Map<string, CatRestriction>> {
  const { rows } = await db.execute({
    sql: 'SELECT category_id, scope, state FROM iptv_category_prefs WHERE cred_id = ? AND content_type = ?',
    args: [credId, type],
  })
  const effective = new Map<string, CatRestriction>()
  // 1. Base globale ('visible' global = équivalent à aucune ligne)
  for (const r of rows as any[]) {
    if (r.scope === 'global' && r.state !== 'visible') effective.set(String(r.category_id), r.state)
  }
  // 2. Surcharge profil : remplace la base dans les deux sens
  if (userId != null) {
    for (const r of rows as any[]) {
      if (r.scope !== String(userId)) continue
      const id = String(r.category_id)
      if (r.state === 'visible') effective.delete(id)
      else effective.set(id, r.state)
    }
  }
  return effective
}

// GET /api/iptv/:credId/category-prefs?type=live — toutes les lignes brutes
// (global + tous profils), pour l'UI d'administration.
router.get('/:credId/category-prefs', async (req, res) => {
  const credId = parseInt(req.params.credId)
  if (!credId) return res.status(404).json({ error: 'invalid credential id' })
  const type = (req.query.type as string) ?? 'live'
  const { rows } = await db.execute({
    sql: 'SELECT category_id, scope, state FROM iptv_category_prefs WHERE cred_id = ? AND content_type = ?',
    args: [credId, type],
  })
  res.json(rows.map((r: any) => ({ category_id: String(r.category_id), scope: String(r.scope), state: r.state as CatState })))
})

// PUT /api/iptv/:credId/category-prefs (admin) — pose/retire un état.
// state null = retour à visible (suppression de la ligne).
const CatPrefSchema = z.object({
  type: z.enum(['live', 'vod', 'series']),
  category_id: z.string().min(1),
  scope: z.string().min(1),            // 'global' ou un user_id
  // 'visible' = surcharge profil qui ré-affiche ; null = retire la ligne (hérite)
  state: z.enum(['hidden', 'locked', 'visible']).nullable(),
})
router.put('/:credId/category-prefs', requireAdmin, async (req, res) => {
  const credId = parseInt(req.params.credId)
  if (!credId) return res.status(404).json({ error: 'invalid credential id' })
  const parsed = CatPrefSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  const { type, category_id, scope, state } = parsed.data
  if (state === null) {
    await db.execute({
      sql: 'DELETE FROM iptv_category_prefs WHERE cred_id = ? AND content_type = ? AND category_id = ? AND scope = ?',
      args: [credId, type, category_id, scope],
    })
  } else {
    await db.execute({
      sql: `INSERT INTO iptv_category_prefs (cred_id, content_type, category_id, scope, state)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cred_id, content_type, category_id, scope) DO UPDATE SET state = excluded.state`,
      args: [credId, type, category_id, scope, state],
    })
  }
  res.json({ ok: true })
})

// PUT /api/iptv/:credId/category-prefs/bulk (admin) — pose un état sur PLUSIEURS
// catégories d'un coup (« tout masquer puis n'autoriser que… »). state null = reset.
const CatPrefBulkSchema = z.object({
  type: z.enum(['live', 'vod', 'series']),
  scope: z.string().min(1),
  state: z.enum(['hidden', 'locked', 'visible']).nullable(),
  category_ids: z.array(z.string().min(1)).min(1).max(2000),
})
router.put('/:credId/category-prefs/bulk', requireAdmin, async (req, res) => {
  const credId = parseInt(req.params.credId)
  if (!credId) return res.status(404).json({ error: 'invalid credential id' })
  const parsed = CatPrefBulkSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  const { type, scope, state, category_ids } = parsed.data
  const stmts = category_ids.map(catId => state === null
    ? {
        sql: 'DELETE FROM iptv_category_prefs WHERE cred_id = ? AND content_type = ? AND category_id = ? AND scope = ?',
        args: [credId, type, catId, scope] as any[],
      }
    : {
        sql: `INSERT INTO iptv_category_prefs (cred_id, content_type, category_id, scope, state)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(cred_id, content_type, category_id, scope) DO UPDATE SET state = excluded.state`,
        args: [credId, type, catId, scope, state] as any[],
      })
  await db.batch(stmts, 'write')
  res.json({ ok: true, count: category_ids.length })
})

// GET /api/iptv/:credId/categories?type=live|vod|series[&all=1]
// Par défaut : catégories masquées exclues, verrouillées marquées state='locked'
// (état effectif pour le profil courant). all=1 (UI admin) = tout, sans filtrage.
router.get('/:credId/categories', async (req, res) => {
  const cred = await getXtreamCred(req.params.credId)
  if (!cred) return res.status(404).json({ error: 'credential not found or incomplete' })
  const type = (req.query.type as string) ?? 'live'
  const all = req.query.all === '1'
  const action = type === 'vod' ? 'get_vod_categories'
               : type === 'series' ? 'get_series_categories'
               : 'get_live_categories'
  try {
    const data = await xtreamCall(cred, action) as any[]
    let cats = data.map(c => ({ id: String(c.category_id), name: c.category_name as string })) as { id: string; name: string; state?: CatState }[]
    if (!all) {
      const effective = await getEffectiveCatPrefs(parseInt(req.params.credId), type, (req as any).userId)
      cats = cats
        .filter(c => effective.get(c.id) !== 'hidden')
        .map(c => effective.get(c.id) === 'locked' ? { ...c, state: 'locked' as CatState } : c)
    }
    res.json(cats)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/iptv/:credId/streams?type=live|vod&category=X&search=Y&languages=fr,en&limit=200
router.get('/:credId/streams', async (req, res) => {
  const credId = parseInt(req.params.credId)
  if (!credId) return res.status(404).json({ error: 'invalid credential id' })
  const typeRaw = req.query.type as string
  const type = (typeRaw === 'vod' ? 'vod' : typeRaw === 'series' ? 'series' : 'live') as 'vod' | 'live' | 'series'
  const category = req.query.category as string | undefined
  const searchRaw = ((req.query.search as string) ?? '').trim()
  const start = Math.max(0, parseInt((req.query.start as string) ?? '0'))
  const limit = Math.min(Math.max(1, parseInt((req.query.limit as string) ?? '300')), 500)
  const langsRaw = (req.query.languages as string) ?? ''
  const langs = new Set(langsRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))
  // Inclure les items sans langue détectée quand "??" est dans la sélection
  const includeUnknown = langs.has('??') || langs.has('UNKNOWN')
  try {
    const all = await getList(credId, type)
    let items = all
    const effective = await getEffectiveCatPrefs(credId, type, (req as any).userId)
    if (category) {
      // Catégorie masquée : rien à servir. Verrouillée : servie — le PIN est
      // demandé côté client AVANT d'ouvrir le groupe.
      if (effective.get(category) === 'hidden') return res.json({ total: 0, start: 0, size: 0, items: [] })
      items = items.filter(it => it.category_id === category)
    } else if (effective.size > 0) {
      // Vue « toutes les catégories » / recherche : le contenu des catégories
      // masquées ET verrouillées est exclu (pas de fuite via la recherche).
      items = items.filter(it => !effective.has(String(it.category_id)))
    }
    if (langs.size > 0) {
      items = items.filter(it => {
        if (!it.language) return includeUnknown
        return langs.has(it.language)
      })
    }
    if (searchRaw) {
      const needle = normalizeTitle(searchRaw)
      items = items.filter(it => normalizeTitle(it.name).includes(needle))
    }
    // Tri (avant pagination — la liste est servie par pages). '' = ordre provider.
    const sort = (req.query.sort as string) ?? ''
    const comparators: Record<string, (a: typeof items[number], b: typeof items[number]) => number> = {
      name_asc: (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
      name_desc: (a, b) => b.name.localeCompare(a.name, 'fr', { sensitivity: 'base' }),
      added_desc: (a, b) => (parseInt(b.added ?? '0') || 0) - (parseInt(a.added ?? '0') || 0),
      year_desc: (a, b) => (parseInt(b.year ?? '0') || 0) - (parseInt(a.year ?? '0') || 0),
      rating_desc: (a, b) => (parseFloat(b.rating ?? '0') || 0) - (parseFloat(a.rating ?? '0') || 0),
    }
    if (comparators[sort]) items = [...items].sort(comparators[sort])
    const total = items.length
    const page = items.slice(start, start + limit)
    res.json({
      total,
      start,
      size: page.length,
      items: page.map(it => ({ ...it, type })),
    })
    // Préchauffe en arrière-plan : page courante (au cas où le browser n'a pas encore
    // tout cached) + page suivante (anticipation du scroll). Le serveur upstream peut
    // être lent ; le browser ne paiera jamais ce coût car il lira depuis le disque local.
    warmImages(page.map(it => it.logo))
    const nextPage = items.slice(start + limit, start + limit * 2)
    warmImages(nextPage.map(it => it.logo))
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/iptv/:credId/series/:seriesId — détail d'une série : saisons + épisodes
// Pas de cache disque, appelé seulement à l'ouverture d'une série (rare vs liste).
router.get('/:credId/series/:seriesId', async (req, res) => {
  const cred = await getXtreamCred(req.params.credId)
  if (!cred) return res.status(404).json({ error: 'credential not found or incomplete' })
  try {
    const data: any = await xtreamCall(cred, 'get_series_info', { series_id: req.params.seriesId })
    const info = data.info ?? {}
    const seasons: any[] = data.seasons ?? []
    const episodesByseason: Record<string, any[]> = data.episodes ?? {}
    // Normalisation : on retourne un tableau de saisons triées avec leurs épisodes.
    const seasonsOut = Object.keys(episodesByseason)
      .map(k => Number(k))
      .sort((a, b) => a - b)
      .map(seasonNum => {
        const seasonMeta = seasons.find((s: any) => Number(s.season_number) === seasonNum) ?? {}
        const eps = (episodesByseason[String(seasonNum)] ?? []).map((ep: any) => ({
          episode_id: String(ep.id),
          episode_num: Number(ep.episode_num),
          title: String(ep.title ?? ''),
          plot: ep.info?.plot as string | undefined,
          duration: ep.info?.duration as string | undefined,
          rating: ep.info?.rating as string | undefined,
          air_date: ep.info?.releasedate as string | undefined,
          container_extension: String(ep.container_extension ?? 'mp4'),
          movie_image: (ep.info?.movie_image || ep.info?.cover_big) as string | undefined,
        }))
        return {
          season_number: seasonNum,
          name: String(seasonMeta.name ?? `Saison ${seasonNum}`),
          cover: seasonMeta.cover as string | undefined,
          overview: seasonMeta.overview as string | undefined,
          episode_count: eps.length,
          episodes: eps,
        }
      })
    res.json({
      info: {
        name: info.name as string,
        cover: info.cover as string | undefined,
        plot: info.plot as string | undefined,
        cast: info.cast as string | undefined,
        director: info.director as string | undefined,
        genre: info.genre as string | undefined,
        release_date: info.release_date as string | undefined,
        rating: info.rating as string | undefined,
      },
      seasons: seasonsOut,
    })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/iptv/:credId/languages?type=live|vod|series — langues détectées avec compte
router.get('/:credId/languages', async (req, res) => {
  const credId = parseInt(req.params.credId)
  if (!credId) return res.status(404).json({ error: 'invalid credential id' })
  const typeRaw = req.query.type as string
  const type = (typeRaw === 'vod' ? 'vod' : typeRaw === 'series' ? 'series' : 'live') as 'vod' | 'live' | 'series'
  try {
    const all = await getList(credId, type)
    const counts = new Map<string, number>()
    for (const it of all) {
      const code = it.language ?? '??'
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    const list = [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
    res.json(list)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/iptv/image?url=...
// Cache disque (data/iptv-image-cache/) en plus du Cache-Control browser.
// Les logos IPTV sont immutables → on les sert pour toujours depuis le disque
// dès le premier fetch, plus jamais besoin de retoucher au serveur upstream.
const IMAGE_CACHE_DIR = join(process.env.DB_PATH ? dirname(process.env.DB_PATH) : process.cwd(), 'iptv-image-cache')
if (!existsSync(IMAGE_CACHE_DIR)) mkdirSync(IMAGE_CACHE_DIR, { recursive: true })

router.get('/image', async (req, res) => {
  const url = req.query.url as string
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).end()
  const hash = createHash('md5').update(url).digest('hex')

  // Hit cache disque : on récupère bytes + content-type stocké en sidecar
  const cachePath = join(IMAGE_CACHE_DIR, hash)
  const ctPath = join(IMAGE_CACHE_DIR, hash + '.ct')
  if (existsSync(cachePath)) {
    try {
      const ct = existsSync(ctPath) ? readFileSync(ctPath, 'utf-8') : 'image/png'
      res.set('Content-Type', ct)
      res.set('Cache-Control', 'public, max-age=2592000, immutable')
      res.set('X-Cache', 'disk')
      return res.send(readFileSync(cachePath))
    } catch { /* fallthrough fetch */ }
  }

  // Cache négatif : URL connue morte (404/timeout récent) → 404 immédiat, avec
  // Cache-Control pour que le navigateur n'insiste pas non plus. Sans ça, chaque
  // rendu re-paie jusqu'à 5 s de timeout PAR vignette quand l'upstream pend.
  if (isDead(hash)) {
    res.set('Cache-Control', 'public, max-age=21600')
    res.set('X-Cache', 'neg')
    return res.status(404).end()
  }

  try {
    // Timeout court (5s) : si le serveur upstream rame, fail fast pour pas bloquer
    // le rendu. Le warmer continuera de tenter en arrière-plan.
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) } as any)
    if (!r.ok) {
      markDead(hash)
      res.set('Cache-Control', 'public, max-age=21600')
      return res.status(r.status).end()
    }
    const ct = r.headers.get('content-type') ?? 'image/png'
    const buf = Buffer.from(await r.arrayBuffer())
    try { writeFileSync(cachePath, buf); writeFileSync(ctPath, ct) } catch {}
    res.set('Content-Type', ct)
    res.set('Cache-Control', 'public, max-age=2592000, immutable')
    res.set('X-Cache', 'miss')
    res.send(buf)
  } catch {
    markDead(hash)
    res.set('Cache-Control', 'public, max-age=21600')
    res.status(504).end()
  }
})

export default router
