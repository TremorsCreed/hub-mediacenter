import { Router } from 'express'
import { db } from '../db'
import crypto from 'crypto'
import { findIptvMatch, listActiveCredentialIds } from '../iptvVodCache'

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

// GET /api/plex/discover/search?q=... — recherche universelle Plex Discover
// (movies/shows agrégés depuis tous les providers, Netflix/Disney+/Prime inclus
// via les availabilities du metadata).
router.get('/discover/search', async (req, res) => {
  const cfg = await getConfig()
  if (!cfg.auth_token) return res.status(400).json({ error: 'not connected to plex' })
  const q = (req.query.q as string)?.trim()
  if (!q) return res.json([])
  try {
    const url = `https://discover.provider.plex.tv/library/search?query=${encodeURIComponent(q)}&searchTypes=movies,tv&searchProviders=discover&includeMetadata=1&X-Plex-Token=${cfg.auth_token}`
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) return res.status(502).json({ error: 'plex discover unreachable' })
    const data: any = await r.json()
    const results: any[] = []
    for (const sec of (data?.MediaContainer?.SearchResults ?? [])) {
      for (const sr of (sec.SearchResult ?? [])) {
        const m = sr.Metadata
        if (!m?.guid) continue
        results.push({
          guid: m.guid as string,                   // plex://show/...  ou plex://movie/...
          key: m.key as string | undefined,         // /library/metadata/{ratingKey}
          ratingKey: m.ratingKey as string | undefined,
          title: m.title as string,
          year: m.year as number | undefined,
          type: m.type as string,                   // movie | show
          thumb: m.thumb as string | undefined,
          art: m.art as string | undefined,
          summary: m.summary as string | undefined,
          duration: m.duration as number | undefined,
          score: sr.score as number | undefined,
        })
      }
    }
    res.json(results)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/plex/discover/:ratingKey/availabilities?title=&year= — plateformes dispo
// Inclut le cross-ref avec les listes VOD IPTV cachées si title/year fournis.
router.get('/discover/:ratingKey/availabilities', async (req, res) => {
  const cfg = await getConfig()
  if (!cfg.auth_token) return res.status(400).json({ error: 'not connected to plex' })
  const title = req.query.title as string | undefined
  const year = req.query.year ? parseInt(req.query.year as string) : undefined
  try {
    const url = `https://metadata.provider.plex.tv/library/metadata/${req.params.ratingKey}/availabilities?X-Plex-Token=${cfg.auth_token}`
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) return res.status(502).json({ error: 'plex metadata unreachable' })
    const data: any = await r.json()
    const list = (data?.MediaContainer?.Availability ?? []).map((a: any) => ({
      platform: a.platform as string,
      title: a.title as string,
      url: a.url as string,
      offerType: a.offerType as string | undefined,
      price: a.price as number | null,
      quality: a.quality as string | undefined,
      iptv_credential_id: undefined as number | undefined,
      iptv_stream_id: undefined as string | undefined,
      iptv_kind: undefined as 'vod' | 'series' | undefined,
    }))

    // Cross-ref VOD + Series IPTV (si title fourni)
    if (title) {
      for (const credId of await listActiveCredentialIds()) {
        const match = await findIptvMatch(credId, title, year)
        if (match) {
          list.push({
            platform: 'iptv',
            title: match.kind === 'series' ? 'IPTV (Série)' : 'IPTV (VOD)',
            url: `internal://iptv/${credId}/${match.kind}/${match.entry.stream_id}`,
            offerType: 'subscription',
            price: null,
            quality: undefined,
            iptv_credential_id: credId,
            iptv_stream_id: match.entry.stream_id,
            iptv_kind: match.kind,
          })
        }
      }
    }
    res.json(list)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/plex/discover/image?url=... — proxy d'image absolute (les thumbs Discover
// pointent sur image.tmdb.org / metadata-static.plex.tv directement, donc mixed-content
// sur HTTP). On rentre pas par /api/plex/image qui suppose un path serveur.
router.get('/discover/image', async (req, res) => {
  const url = req.query.url as string
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).end()
  try {
    const r = await fetch(url)
    if (!r.ok) return res.status(r.status).end()
    res.set('Content-Type', r.headers.get('content-type') ?? 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=2592000, immutable')
    res.send(Buffer.from(await r.arrayBuffer()))
  } catch {
    res.status(502).end()
  }
})

// GET /api/plex/show/:ratingKey — info série + saisons + tous les épisodes regroupés.
// Une seule requête Plex pour les épisodes (allLeaves), groupés par saison côté hub.
router.get('/show/:ratingKey', async (req, res) => {
  const cfg = await getConfig()
  if (!cfg.auth_token || !cfg.server_url) return res.status(400).json({ error: 'not connected to plex' })
  try {
    const [showRes, seasonsRes, episodesRes] = await Promise.all([
      fetch(`${cfg.server_url}/library/metadata/${req.params.ratingKey}?X-Plex-Token=${cfg.auth_token}`, { headers: { Accept: 'application/json' } }),
      fetch(`${cfg.server_url}/library/metadata/${req.params.ratingKey}/children?X-Plex-Token=${cfg.auth_token}`, { headers: { Accept: 'application/json' } }),
      fetch(`${cfg.server_url}/library/metadata/${req.params.ratingKey}/allLeaves?X-Plex-Token=${cfg.auth_token}`, { headers: { Accept: 'application/json' } }),
    ])
    if (!showRes.ok) return res.status(502).json({ error: 'plex show fetch failed' })
    const showData: any = await showRes.json()
    const seasonsData: any = seasonsRes.ok ? await seasonsRes.json() : { MediaContainer: { Metadata: [] } }
    const episodesData: any = episodesRes.ok ? await episodesRes.json() : { MediaContainer: { Metadata: [] } }

    const show = showData?.MediaContainer?.Metadata?.[0] ?? {}
    const seasons: any[] = seasonsData?.MediaContainer?.Metadata ?? []
    const episodes: any[] = episodesData?.MediaContainer?.Metadata ?? []

    // Group episodes by parentRatingKey (= season ratingKey)
    const bySeason = new Map<string, any[]>()
    for (const ep of episodes) {
      const k = String(ep.parentRatingKey ?? '')
      if (!bySeason.has(k)) bySeason.set(k, [])
      bySeason.get(k)!.push(ep)
    }

    const seasonsOut = seasons
      .filter(s => s.type === 'season')  // pas "specials" parfois étrange
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(season => ({
        ratingKey: String(season.ratingKey),
        season_number: Number(season.index ?? 0),
        title: season.title as string,
        thumb: season.thumb as string | undefined,
        episode_count: Number(season.leafCount ?? bySeason.get(String(season.ratingKey))?.length ?? 0),
        viewed_count: Number(season.viewedLeafCount ?? 0),
        episodes: (bySeason.get(String(season.ratingKey)) ?? [])
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map(ep => ({
            ratingKey: String(ep.ratingKey),
            episode_number: Number(ep.index ?? 0),
            title: ep.title as string,
            summary: ep.summary as string | undefined,
            duration: ep.duration as number | undefined,
            viewOffset: ep.viewOffset as number | undefined,
            viewCount: ep.viewCount as number | undefined,
            thumb: ep.thumb as string | undefined,
            air_date: ep.originallyAvailableAt as string | undefined,
            rating: ep.rating as number | undefined,
          })),
      }))

    res.json({
      info: {
        ratingKey: String(show.ratingKey),
        title: show.title as string,
        year: show.year as number | undefined,
        thumb: show.thumb as string | undefined,
        art: show.art as string | undefined,
        summary: show.summary as string | undefined,
        rating: show.rating as number | undefined,
        contentRating: show.contentRating as string | undefined,
        leafCount: Number(show.leafCount ?? 0),
        viewedLeafCount: Number(show.viewedLeafCount ?? 0),
      },
      seasons: seasonsOut,
    })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/plex/onDeck?limit=20 — items en cours de lecture (continue watching)
router.get('/onDeck', async (req, res) => {
  const cfg = await getConfig()
  if (!cfg.auth_token || !cfg.server_url) return res.status(400).json({ error: 'not connected to plex' })
  const limit = Math.min(parseInt((req.query.limit as string) ?? '20'), 50)
  try {
    const r = await fetch(`${cfg.server_url}/library/onDeck?X-Plex-Token=${cfg.auth_token}&X-Plex-Container-Size=${limit}`, {
      headers: { Accept: 'application/json' }
    })
    if (!r.ok) return res.status(502).json({ error: 'plex unreachable' })
    const data = await r.json() as any
    const rawItems = (data?.MediaContainer?.Metadata ?? []).map((m: any) => ({
      ratingKey: String(m.ratingKey),
      title: m.title as string,
      year: m.year as number | undefined,
      type: m.type as string,
      thumb: (m.thumb || m.grandparentThumb || m.parentThumb) as string | undefined,
      art: m.art as string | undefined,
      summary: m.summary as string | undefined,
      duration: m.duration as number | undefined,
      viewOffset: m.viewOffset as number | undefined,
      viewedAt: m.lastViewedAt as number | undefined,
      grandparentTitle: m.grandparentTitle as string | undefined,
      parentIndex: m.parentIndex as number | undefined,
      index: m.index as number | undefined,
    }))
    // Dédup par (title|year|grandparent) pour ne pas montrer le même film présent dans
    // plusieurs bibliothèques. On garde le plus récemment vu.
    const byKey = new Map<string, typeof rawItems[0]>()
    for (const it of rawItems) {
      const key = `${it.grandparentTitle ?? ''}|${it.title}|${it.year ?? ''}`
      const prev = byKey.get(key)
      if (!prev || (it.viewedAt ?? 0) > (prev.viewedAt ?? 0)) byKey.set(key, it)
    }
    res.json([...byKey.values()].sort((a, b) => (b.viewedAt ?? 0) - (a.viewedAt ?? 0)))
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
      viewOffset: m.viewOffset as number | undefined,
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
