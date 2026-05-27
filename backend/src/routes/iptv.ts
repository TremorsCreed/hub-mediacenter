import { Router } from 'express'
import { db } from '../db'
import { getList, normalizeTitle } from '../iptvVodCache'

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

// GET /api/iptv/:credId/streams?type=live|vod&category=X&search=Y&limit=200
// Utilise le cache mémoire (préchargé au démarrage backend) → réponse < 50ms
// pour des collections de 100K+ items, vs ~5s en hit direct API Xtream.
router.get('/:credId/streams', async (req, res) => {
  const credId = parseInt(req.params.credId)
  if (!credId) return res.status(404).json({ error: 'invalid credential id' })
  const type = ((req.query.type as string) === 'vod' ? 'vod' : 'live') as 'vod' | 'live'
  const category = req.query.category as string | undefined
  const searchRaw = ((req.query.search as string) ?? '').trim()
  const limit = Math.min(parseInt((req.query.limit as string) ?? '200'), 1000)
  try {
    const all = await getList(credId, type)
    let items = all
    if (category) items = items.filter(it => it.category_id === category)
    if (searchRaw) {
      const needle = normalizeTitle(searchRaw)
      items = items.filter(it => normalizeTitle(it.name).includes(needle))
    }
    res.json({
      total: items.length,
      items: items.slice(0, limit).map(it => ({ ...it, type })),
    })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/iptv/image?url=...
router.get('/image', async (req, res) => {
  const url = req.query.url as string
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).end()
  try {
    const r = await fetch(url)
    if (!r.ok) return res.status(r.status).end()
    res.set('Content-Type', r.headers.get('content-type') ?? 'image/png')
    res.set('Cache-Control', 'public, max-age=2592000, immutable')
    res.send(Buffer.from(await r.arrayBuffer()))
  } catch {
    res.status(502).end()
  }
})

export default router
