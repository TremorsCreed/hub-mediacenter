import { Router } from 'express'
import { db } from '../db'
import crypto from 'crypto'

const router = Router()

const PLEX_PRODUCT = 'Hub MediaCenter'
const PLEX_TV = 'https://plex.tv'

function plexHeaders(clientId: string) {
  return {
    'Accept': 'application/json',
    'X-Plex-Product': PLEX_PRODUCT,
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Version': '1.0.0',
  }
}

async function getConfig() {
  const { rows } = await db.execute('SELECT * FROM plex_config WHERE id = 1')
  const row = rows[0] as any
  if (!row.client_id) {
    const clientId = crypto.randomUUID().replace(/-/g, '')
    await db.execute({ sql: 'UPDATE plex_config SET client_id = ? WHERE id = 1', args: [clientId] })
    row.client_id = clientId
  }
  return row as { client_id: string; auth_token: string; server_url: string; server_machine_id: string }
}

// GET /api/plex/status
router.get('/status', async (_req, res) => {
  const cfg = await getConfig()
  res.json({
    connected: !!cfg.auth_token,
    server_url: cfg.server_url || null,
    server_machine_id: cfg.server_machine_id || null,
  })
})

// POST /api/plex/pin — démarre le flow PIN
router.post('/pin', async (_req, res) => {
  const cfg = await getConfig()
  const r = await fetch(`${PLEX_TV}/api/v2/pins`, {
    method: 'POST',
    headers: { ...plexHeaders(cfg.client_id), 'Content-Type': 'application/json' },
    body: JSON.stringify({ strong: true })
  })
  if (!r.ok) return res.status(502).json({ error: 'plex.tv unreachable' })
  const data = await r.json() as any
  const authUrl = `https://app.plex.tv/auth#?clientID=${cfg.client_id}&code=${data.code}&context[device][product]=${encodeURIComponent(PLEX_PRODUCT)}`
  res.json({ id: data.id, pin: data.code, auth_url: authUrl })
})

// GET /api/plex/pin/:id — poll jusqu'à avoir le token
router.get('/pin/:id', async (req, res) => {
  const cfg = await getConfig()
  const r = await fetch(`${PLEX_TV}/api/v2/pins/${req.params.id}`, {
    headers: plexHeaders(cfg.client_id)
  })
  if (!r.ok) return res.status(502).json({ error: 'plex.tv unreachable' })
  const data = await r.json() as any

  if (!data.authToken) return res.json({ done: false })

  // Token obtenu — on récupère aussi la liste des serveurs
  let serverUrl = ''
  let serverMachineId = ''
  try {
    const sr = await fetch(`${PLEX_TV}/api/v2/resources?includeHttps=1&includeRelay=0`, {
      headers: { ...plexHeaders(cfg.client_id), 'X-Plex-Token': data.authToken }
    })
    if (sr.ok) {
      const resources = await sr.json() as any[]
      const server = resources.find((r: any) => r.provides?.includes('server'))
      if (server) {
        // Préférer la connexion locale HTTP (pas plex.direct, pas relay)
        const conns = server.connections ?? []
        const conn = conns.find((c: any) => c.local && !c.relay && c.protocol === 'http')
          ?? conns.find((c: any) => c.local && !c.relay)
          ?? conns.find((c: any) => !c.relay)
          ?? conns[0]
        // Reconstruire l'URL avec l'adresse IP si c'est un hostname plex.direct
        const uri: string = conn?.uri ?? ''
        serverUrl = uri.includes('.plex.direct')
          ? `http://${conn.address}:${conn.port}`
          : uri
        serverMachineId = server.clientIdentifier ?? ''
      }
    }
  } catch {}

  await db.execute({
    sql: 'UPDATE plex_config SET auth_token = ?, server_url = ?, server_machine_id = ?, updated_at = ? WHERE id = 1',
    args: [data.authToken, serverUrl, serverMachineId, Date.now()]
  })

  res.json({ done: true, server_url: serverUrl, server_machine_id: serverMachineId })
})

// DELETE /api/plex/token — déconnexion
router.delete('/token', async (_req, res) => {
  await db.execute("UPDATE plex_config SET auth_token = '', server_url = '', server_machine_id = '' WHERE id = 1")
  res.json({ ok: true })
})

// GET /api/plex/resolve/:ratingKey — résout un rating key en slug watch.plex.tv
router.get('/resolve/:ratingKey', async (req, res) => {
  const cfg = await getConfig()
  if (!cfg.auth_token || !cfg.server_url) return res.status(400).json({ error: 'not connected to plex' })

  try {
    const r = await fetch(
      `${cfg.server_url}/library/metadata/${req.params.ratingKey}?X-Plex-Token=${cfg.auth_token}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!r.ok) return res.status(502).json({ error: 'plex server unreachable' })
    const data = await r.json() as any
    const meta = data?.MediaContainer?.Metadata?.[0]
    if (!meta) return res.status(404).json({ error: 'not found' })

    const slug = meta.slug as string | undefined
    const type = meta.type as string
    const watchUrl = slug ? `https://watch.plex.tv/${type === 'episode' ? 'show' : type}/${slug}` : null

    res.json({ slug, type, watch_url: watchUrl, title: meta.title })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/plex/sections — liste des bibliothèques (movies, shows, music, ...)
router.get('/sections', async (_req, res) => {
  const cfg = await getConfig()
  if (!cfg.auth_token || !cfg.server_url) return res.status(400).json({ error: 'not connected to plex' })
  try {
    const r = await fetch(`${cfg.server_url}/library/sections?X-Plex-Token=${cfg.auth_token}`, {
      headers: { Accept: 'application/json' }
    })
    if (!r.ok) return res.status(502).json({ error: 'plex unreachable' })
    const data = await r.json() as any
    const sections = (data?.MediaContainer?.Directory ?? []).map((d: any) => ({
      id: String(d.key),
      title: d.title as string,
      type: d.type as string,
      agent: d.agent as string | undefined,
    }))
    res.json(sections)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/plex/sections/:id/all?start=0&size=50&sort=titleSort
router.get('/sections/:id/all', async (req, res) => {
  const cfg = await getConfig()
  if (!cfg.auth_token || !cfg.server_url) return res.status(400).json({ error: 'not connected to plex' })
  const start = parseInt((req.query.start as string) ?? '0')
  const size = Math.min(parseInt((req.query.size as string) ?? '50'), 200)
  const sort = (req.query.sort as string) ?? 'titleSort'
  const search = req.query.search as string | undefined
  try {
    const params = new URLSearchParams({
      'X-Plex-Token': cfg.auth_token,
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(size),
      sort,
    })
    if (search) params.set('title', search)
    const r = await fetch(`${cfg.server_url}/library/sections/${req.params.id}/all?${params}`, {
      headers: { Accept: 'application/json' }
    })
    if (!r.ok) return res.status(502).json({ error: 'plex unreachable' })
    const data = await r.json() as any
    const items = (data?.MediaContainer?.Metadata ?? []).map((m: any) => ({
      ratingKey: String(m.ratingKey),
      title: m.title as string,
      year: m.year as number | undefined,
      type: m.type as string,
      thumb: m.thumb as string | undefined,
      art: m.art as string | undefined,
      summary: m.summary as string | undefined,
      duration: m.duration as number | undefined,
      rating: m.rating as number | undefined,
      contentRating: m.contentRating as string | undefined,
      addedAt: m.addedAt as number | undefined,
      viewCount: m.viewCount as number | undefined,
    }))
    res.json({
      total: data?.MediaContainer?.totalSize ?? items.length,
      start, size, items
    })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/plex/image?path=/library/metadata/123/thumb/xxx — proxy d'image avec token
router.get('/image', async (req, res) => {
  const cfg = await getConfig()
  if (!cfg.auth_token || !cfg.server_url) return res.status(400).end()
  const path = req.query.path as string
  if (!path || !path.startsWith('/')) return res.status(400).end()
  try {
    const r = await fetch(`${cfg.server_url}${path}?X-Plex-Token=${cfg.auth_token}`)
    if (!r.ok) return res.status(r.status).end()
    res.set('Content-Type', r.headers.get('content-type') ?? 'image/jpeg')
    // Les thumbs Plex sont immuables par ratingKey — on cache 30 jours, immutable.
    res.set('Cache-Control', 'public, max-age=2592000, immutable')
    res.send(Buffer.from(await r.arrayBuffer()))
  } catch {
    res.status(502).end()
  }
})

export async function resolvePlexWatchUrl(ratingKey: string): Promise<string | null> {
  try {
    const { rows } = await db.execute('SELECT auth_token, server_url FROM plex_config WHERE id = 1')
    const cfg = rows[0] as any
    if (!cfg?.auth_token || !cfg?.server_url) return null

    const r = await fetch(
      `${cfg.server_url}/library/metadata/${ratingKey}?X-Plex-Token=${cfg.auth_token}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!r.ok) return null
    const data = await r.json() as any
    const meta = data?.MediaContainer?.Metadata?.[0]
    const slug = meta?.slug as string | undefined
    const type = meta?.type as string
    if (!slug) return null
    return `https://watch.plex.tv/${type === 'episode' ? 'show' : type}/${slug}`
  } catch {
    return null
  }
}

export default router
