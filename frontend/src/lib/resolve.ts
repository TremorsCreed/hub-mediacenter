import { api, ScrapedListItem, PlexSection, PlexShowDetail, PlaylistItemInput, IptvSeriesInfo } from '../api'

// Résolution d'un item « titre » (issu d'un import ou d'une édition JSON) vers une
// source jouable : Plex en priorité, puis IPTV (langue préférée), sinon « manquant ».
// Factorisé depuis ImportPlaylist pour être réutilisé par l'éditeur JSON.

type IptvSeriesHit = { info: IptvSeriesInfo; logo?: string }
export type ResolveCache = {
  shows: Map<string, PlexShowDetail | null>
  iptvSeries: Map<string, IptvSeriesHit | null>
}
export const makeResolveCache = (): ResolveCache => ({ shows: new Map(), iptvSeries: new Map() })

export const norm = (s?: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
export const titleMatches = (a?: string, b?: string) => {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

// Sections Plex + 1er credential IPTV — contexte commun à une passe de résolution.
export async function loadResolveContext(): Promise<{ sections: PlexSection[]; credId: number | null }> {
  const [sections, creds] = await Promise.all([
    api.plex.sections().catch(() => [] as PlexSection[]),
    api.iptv.credentials().catch(() => [] as { id: number; name: string }[]),
  ])
  return { sections, credId: creds[0]?.id ?? null }
}

// Trouve (et met en cache) le détail d'un show Plex à partir de son titre.
async function findPlexShow(showTitle: string, year: number | null | undefined, sections: PlexSection[], cache: ResolveCache): Promise<PlexShowDetail | null> {
  const key = norm(showTitle)
  if (cache.shows.has(key)) return cache.shows.get(key)!
  let detail: PlexShowDetail | null = null
  for (const sec of sections.filter(s => s.type === 'show')) {
    try {
      const r = await api.plex.sectionItems(sec.id, { size: 6, search: showTitle })
      const best =
        r.items.find(c => titleMatches(c.title, showTitle) && !!year && !!c.year && Math.abs((c.year ?? 0) - year) <= 1) ||
        r.items.find(c => titleMatches(c.title, showTitle))
      if (best) { detail = await api.plex.show(best.ratingKey); break }
    } catch { /* section KO, on continue */ }
  }
  cache.shows.set(key, detail)
  return detail
}

// Trouve (et met en cache) la série IPTV correspondant à un titre, infos épisodes incluses.
async function findIptvSeries(showTitle: string, credId: number, cache: ResolveCache): Promise<IptvSeriesHit | null> {
  const key = norm(showTitle)
  if (cache.iptvSeries.has(key)) return cache.iptvSeries.get(key)!
  let hit: IptvSeriesHit | null = null
  try {
    // Pas de filtre langue ici : on veut maximiser les chances de retrouver l'épisode.
    const r = await api.iptv.streams(credId, { type: 'series', search: showTitle, limit: 8 })
    const best = r.items.find(s => titleMatches(s.name, showTitle)) ?? r.items[0]
    if (best) hit = { info: await api.iptv.seriesInfo(credId, best.stream_id), logo: best.logo }
  } catch { /* IPTV KO, on laisse null */ }
  cache.iptvSeries.set(key, hit)
  return hit
}

// Résout un épisode vers l'épisode Plex précis, sinon vers l'épisode IPTV, sinon « manquant ».
async function resolveEpisode(item: ScrapedListItem, sections: PlexSection[], credId: number | null, cache: ResolveCache, lang: string): Promise<PlaylistItemInput> {
  const showTitle = item.show_title ?? item.title
  // 1) Plex
  const show = await findPlexShow(showTitle, item.year, sections, cache)
  if (show && item.season != null && item.episode != null) {
    const season = show.seasons.find(s => s.season_number === item.season)
    const ep = season?.episodes.find(e => e.episode_number === item.episode)
    if (ep) return { app: 'plex', ref_id: ep.ratingKey, ref_type: 'episode', title: item.title, year: item.year ?? undefined, thumb: ep.thumb ?? show.info.thumb, status: 'resolved' }
  }
  // 2) IPTV (épisode VOD de série) — récupère ce que Plex n'a pas
  if (credId != null && item.season != null && item.episode != null) {
    const series = await findIptvSeries(showTitle, credId, cache)
    const season = series?.info.seasons.find(s => s.season_number === item.season)
    const ep = season?.episodes.find(e => e.episode_num === item.episode)
    if (ep) return { app: 'iptv', ref_id: ep.episode_id, ref_type: 'series', title: item.title, year: item.year ?? undefined, thumb: ep.movie_image ?? series?.logo, lang, ext: ep.container_extension, status: 'resolved' }
  }
  return { app: 'unresolved', ref_type: 'episode', title: item.title, year: item.year ?? undefined, status: 'missing' }
}

// Résout un film/série vers Plex (prioritaire) puis IPTV (langue donnée).
export async function resolveScrapedItem(item: ScrapedListItem, sections: PlexSection[], credId: number | null, cache: ResolveCache, lang: string): Promise<PlaylistItemInput> {
  if (item.kind === 'episode') return resolveEpisode(item, sections, credId, cache, lang)
  const wantShow = item.type === 'series'
  const secs = sections.filter(s => (wantShow ? s.type === 'show' : s.type === 'movie'))
  for (const sec of secs) {
    for (const q of [item.title, item.original_title].filter(Boolean) as string[]) {
      try {
        const r = await api.plex.sectionItems(sec.id, { size: 6, search: q })
        const cands = r.items
        const best =
          cands.find(c => titleMatches(c.title, item.title) && !!item.year && !!c.year && Math.abs((c.year ?? 0) - item.year) <= 1) ||
          cands.find(c => titleMatches(c.title, q))
        if (best) return { app: 'plex', ref_id: best.ratingKey, ref_type: best.type, title: best.title, year: best.year ?? item.year ?? undefined, thumb: best.thumb, status: 'resolved' }
      } catch { /* section search KO, on continue */ }
    }
  }
  if (credId) {
    const type = wantShow ? 'series' : 'vod'
    try {
      const r = await api.iptv.streams(credId, { type, search: item.title, languages: lang ? [lang] : undefined, limit: 8 })
      const best = r.items.find(s => titleMatches(s.name, item.title)) ?? r.items[0]
      if (best) return { app: 'iptv', ref_id: best.stream_id, ref_type: type, title: item.title, year: item.year ?? undefined, thumb: best.logo, lang, status: 'resolved' }
    } catch { /* */ }
  }
  return { app: 'unresolved', ref_type: item.type, title: item.title, year: item.year ?? undefined, status: 'missing' }
}
