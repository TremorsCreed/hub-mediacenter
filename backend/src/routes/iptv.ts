import { Router } from 'express'
import { db } from '../db'

const router = Router()

async function getXtreamCred(id: string) {
  const { rows } = await db.execute({ sql: 'SELECT data FROM credentials WHERE id = ? AND type = ?', args: [id, 'xtream'] })
  if (!rows.length) return null
  const data = JSON.parse((rows[0] as any).data as string)
  if (!data.server || !data.user || !data.pass) return null
  return {
    server: String(data.server).replace(/\/+$/, ''),
    user: String(data.user),
    pass: String(data.pass),
    ext: String(data.ext ?? 'ts'),
  }
}

async function xtreamCall(cred: NonNullable<Awaited<ReturnType<typeof getXtreamCred>>>, action: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ username: cred.user, password: cred.pass, action, ...extra })
  const url = `${cred.server}/player_api.php?${params}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`xtream ${action} failed: ${r.status}`)
  return r.json()
}

// GET /api/iptv/credentials — profils Xtream disponibles (nom uniquement)
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
router.get('/:credId/streams', async (req, res) => {
  const cred = await getXtreamCred(req.params.credId)
  if (!cred) return res.status(404).json({ error: 'credential not found or incomplete' })
  const type = (req.query.type as string) ?? 'live'
  const category = req.query.category as string | undefined
  const search = ((req.query.search as string) ?? '').toLowerCase().trim()
  const limit = Math.min(parseInt((req.query.limit as string) ?? '200'), 1000)
  const action = type === 'vod' ? 'get_vod_streams' : 'get_live_streams'
  try {
    const extra: Record<string, string> = {}
    if (category) extra.category_id = category
    const data = await xtreamCall(cred, action, extra) as any[]
    let items = data.map(s => ({
      stream_id: String(s.stream_id),
      name: s.name as string,
      logo: (s.stream_icon || s.cover) as string | undefined,
      category_id: String(s.category_id ?? ''),
      added: s.added as string | undefined,
      rating: s.rating as string | undefined,
      year: s.releaseDate as string | undefined,
      type,
    }))
    if (search) items = items.filter(it => it.name?.toLowerCase().includes(search))
    res.json({ total: items.length, items: items.slice(0, limit) })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/iptv/image?url=... — proxy d'image (les logos M3U sont parfois en http et le browser bloque mixed-content)
router.get('/image', async (req, res) => {
  const url = req.query.url as string
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).end()
  try {
    const r = await fetch(url)
    if (!r.ok) return res.status(r.status).end()
    res.set('Content-Type', r.headers.get('content-type') ?? 'image/png')
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(Buffer.from(await r.arrayBuffer()))
  } catch {
    res.status(502).end()
  }
})

export default router
