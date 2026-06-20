import { Router } from 'express'
import { z } from 'zod'

const router = Router()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const TRAKT_API = 'https://api.trakt.tv'
const CLIENT_ID = process.env.TRAKT_CLIENT_ID ?? ''

function clean(s: any): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

// Préfixe https:// aux chemins d'images Trakt (renvoyés sans protocole).
function img(path?: string | null): string | null {
  if (!path) return null
  return path.startsWith('http') ? path : `https://${path}`
}

// Appel REST Trakt (lecture publique : client_id seul en trakt-api-key).
async function trakt<T = any>(path: string): Promise<{ data: T; res: Response }> {
  const res = await fetch(`${TRAKT_API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': CLIENT_ID,
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(15000) as any,
  })
  if (!res.ok) throw new Error(`Trakt a répondu ${res.status}`)
  const data = (await res.json()) as T
  return { data, res }
}

// Item de liste Trakt → forme enrichie consommée par ImportPlaylist (granularité épisode).
function mapItem(it: any) {
  const position = typeof it.rank === 'number' ? it.rank : 0
  if (it.type === 'movie' && it.movie) {
    const m = it.movie
    return {
      position,
      kind: 'movie' as const,
      type: 'movie' as const,
      title: clean(m.title),
      original_title: m.original_title ? clean(m.original_title) : null,
      year: typeof m.year === 'number' ? m.year : null,
      ids: pickIds(m.ids),
    }
  }
  if (it.type === 'episode' && it.episode && it.show) {
    const ep = it.episode
    const show = it.show
    const s = typeof ep.season === 'number' ? ep.season : null
    const n = typeof ep.number === 'number' ? ep.number : null
    const tag = s != null && n != null ? `S${String(s).padStart(2, '0')}E${String(n).padStart(2, '0')}` : ''
    const epTitle = clean(ep.title)
    return {
      position,
      kind: 'episode' as const,
      type: 'series' as const,
      title: [clean(show.title), tag, epTitle].filter(Boolean).join(' · '),
      year: typeof show.year === 'number' ? show.year : null,
      show_title: clean(show.title),
      season: s,
      episode: n,
      episode_title: epTitle || null,
      show_ids: pickIds(show.ids),
      ids: pickIds(ep.ids),
    }
  }
  // show / season entiers → traités comme une série en bloc
  const sh = it.show ?? it.season?.show
  if (sh) {
    return {
      position,
      kind: 'show' as const,
      type: 'series' as const,
      title: clean(sh.title),
      year: typeof sh.year === 'number' ? sh.year : null,
      ids: pickIds(sh.ids),
    }
  }
  return null
}

function pickIds(ids: any): Record<string, any> | undefined {
  if (!ids) return undefined
  const out: Record<string, any> = {}
  if (ids.imdb) out.imdb = ids.imdb
  if (ids.tmdb) out.tmdb = ids.tmdb
  if (ids.trakt) out.trakt = ids.trakt
  if (ids.tvdb) out.tvdb = ids.tvdb
  if (ids.plex?.guid) out.plex_guid = ids.plex.guid
  return Object.keys(out).length ? out : undefined
}

// Construit les chemins meta + items à partir d'une URL ou d'un id de liste.
function resolveListPaths(input: string): { meta: string; items: string } | null {
  const s = input.trim()
  // id numérique direct (issu de la recherche)
  if (/^\d+$/.test(s)) return { meta: `/lists/${s}`, items: `/lists/${s}/items` }
  let url = s
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  const m = url.match(/\/users\/([^/]+)\/lists\/([^/?#]+)/i)
  if (m) {
    const user = encodeURIComponent(m[1])
    const list = encodeURIComponent(m[2])
    return { meta: `/users/${user}/lists/${list}`, items: `/users/${user}/lists/${list}/items` }
  }
  const idOnly = url.match(/\/lists\/(\d+)/i)
  if (idOnly) return { meta: `/lists/${idOnly[1]}`, items: `/lists/${idOnly[1]}/items` }
  return null
}

// ── Recherche de listes ──────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  if (!CLIENT_ID) return res.status(503).json({ error: 'Trakt non configuré (TRAKT_CLIENT_ID manquant).' })
  const q = clean(req.query.q)
  if (q.length < 2) return res.json([])
  try {
    const { data } = await trakt<any[]>(`/search/list?query=${encodeURIComponent(q)}&limit=16&extended=full`)
    const items = (data ?? [])
      .map((r: any) => r.list)
      .filter(Boolean)
      .filter((l: any) => (l.item_count ?? 0) > 0)
      .map((l: any) => ({
        id: l.ids?.trakt ?? 0,
        title: clean(l.name),
        url: l.user?.ids?.slug && l.ids?.slug
          ? `https://trakt.tv/users/${l.user.ids.slug}/lists/${l.ids.slug}`
          : `https://trakt.tv/lists/${l.ids?.trakt ?? ''}`,
        cover: img(l.images?.posters?.[0]),
        likes: Number(l.likes ?? 0),
        item_count: Number(l.item_count ?? 0),
      }))
    res.json(items)
  } catch (e: any) {
    res.status(502).json({ error: `Recherche Trakt indisponible : ${e.message}` })
  }
})

// ── Découverte : tendances (films + séries), client_id seul ──────────────────
router.get('/discover', async (_req, res) => {
  if (!CLIENT_ID) return res.status(503).json({ error: 'Trakt non configuré (TRAKT_CLIENT_ID manquant).' })
  try {
    const [mv, sh] = await Promise.all([
      trakt<any[]>('/movies/trending?limit=16&extended=full,images'),
      trakt<any[]>('/shows/trending?limit=16&extended=full,images'),
    ])
    const movies = (mv.data ?? []).map((x: any) => ({
      type: 'movie' as const,
      title: clean(x.movie?.title),
      year: typeof x.movie?.year === 'number' ? x.movie.year : null,
      ids: pickIds(x.movie?.ids),
      poster: img(x.movie?.images?.poster?.[0]),
    })).filter((m: any) => m.title)
    const shows = (sh.data ?? []).map((x: any) => ({
      type: 'show' as const,
      title: clean(x.show?.title),
      year: typeof x.show?.year === 'number' ? x.show.year : null,
      ids: pickIds(x.show?.ids),
      poster: img(x.show?.images?.poster?.[0]),
    })).filter((s: any) => s.title)
    res.json({ movies, shows })
  } catch (e: any) {
    res.status(502).json({ error: `Découverte Trakt indisponible : ${e.message}` })
  }
})

// ── Détail d'une liste (métadonnées + TOUS les items, paginés) ───────────────
router.post('/scrape', async (req, res) => {
  if (!CLIENT_ID) return res.status(503).json({ error: 'Trakt non configuré (TRAKT_CLIENT_ID manquant).' })
  const parsed = z.object({ url: z.string().min(1) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'url ou id de liste requis' })
  const paths = resolveListPaths(parsed.data.url)
  if (!paths) return res.status(400).json({ error: 'URL de liste Trakt attendue (format trakt.tv/users/<user>/lists/<slug>).' })

  try {
    const { data: meta } = await trakt<any>(paths.meta)
    if (!meta?.ids) return res.status(404).json({ error: 'Liste introuvable.' })

    const PAGE = 100
    let page = 1
    let pageCount = 1
    const raw: any[] = []
    do {
      const { data, res: r } = await trakt<any[]>(`${paths.items}?extended=full&page=${page}&limit=${PAGE}`)
      raw.push(...(data ?? []))
      pageCount = Number(r.headers.get('x-pagination-page-count') ?? page)
      page++
    } while (page <= pageCount && page <= 20)

    const items = raw
      .map(mapItem)
      .filter(Boolean)
      .sort((a: any, b: any) => a.position - b.position)

    res.json({
      title: clean(meta.name) || 'Liste Trakt',
      cover: img(meta.images?.posters?.[0]) ?? null,
      description: meta.description ? clean(meta.description).slice(0, 500) : null,
      likes: Number(meta.likes ?? 0),
      total: items.length,
      source_url: parsed.data.url.trim(),
      items,
    })
  } catch (e: any) {
    res.status(502).json({ error: `Échec du chargement : ${e.message}` })
  }
})

export default router
