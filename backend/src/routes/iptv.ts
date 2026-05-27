import { Router } from 'express'
import { db } from '../db'
import { getList, normalizeTitle } from '../iptvVodCache'
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

// GET /api/iptv/credentials
router.get('/credentials', async (_req, res) => {
  const { rows } = await db.execute("SELECT id, name FROM credentials WHERE type = 'xtream' ORDER BY name")
  res.json(rows.map((r: any) => ({ id: r.id, name: r.name })))
})

// GET /api/iptv/:credId/categories?type=live|vod
router.get('/:credId/categories', async (req, res) => {
  const cred = await getXtreamCred(req.params.credId)
  if (!cred) return res.status(404).json({ error: 'credential not found or incomplete' })
  const type = (req.query.type as string) ?? 'live'
  const action = type === 'vod' ? 'get_vod_categories' : 'get_live_categories'
  try {
    const data = await xtreamCall(cred, action) as any[]
    res.json(data.map(c => ({ id: String(c.category_id), name: c.category_name as string })))
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/iptv/:credId/streams?type=live|vod&category=X&search=Y&languages=fr,en&limit=200
router.get('/:credId/streams', async (req, res) => {
  const credId = parseInt(req.params.credId)
  if (!credId) return res.status(404).json({ error: 'invalid credential id' })
  const type = ((req.query.type as string) === 'vod' ? 'vod' : 'live') as 'vod' | 'live'
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
    if (category) items = items.filter(it => it.category_id === category)
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
    const total = items.length
    const page = items.slice(start, start + limit)
    res.json({
      total,
      start,
      size: page.length,
      items: page.map(it => ({ ...it, type })),
    })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/iptv/:credId/languages?type=live|vod — langues détectées avec compte
router.get('/:credId/languages', async (req, res) => {
  const credId = parseInt(req.params.credId)
  if (!credId) return res.status(404).json({ error: 'invalid credential id' })
  const type = ((req.query.type as string) === 'vod' ? 'vod' : 'live') as 'vod' | 'live'
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

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) } as any)
    if (!r.ok) return res.status(r.status).end()
    const ct = r.headers.get('content-type') ?? 'image/png'
    const buf = Buffer.from(await r.arrayBuffer())
    // Write cache (fire-and-forget side effect)
    try { writeFileSync(cachePath, buf); writeFileSync(ctPath, ct) } catch {}
    res.set('Content-Type', ct)
    res.set('Cache-Control', 'public, max-age=2592000, immutable')
    res.set('X-Cache', 'miss')
    res.send(buf)
  } catch {
    res.status(502).end()
  }
})

export default router
