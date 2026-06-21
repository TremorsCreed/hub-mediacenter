// Matching catalogue pour le Sprint Companion.
//
// A partir d'un media resolu (titre, annee, type movie/show, ids tmdb/imdb), on
// determine s'il est disponible dans le catalogue de l'utilisateur, en reutilisant
// la logique de cross-ref que la section Discover fait deja :
//   1) Bibliotheque Plex PERSO  -> recherche par titre dans les sections, verifiee
//      par les Guid externes (imdb/tmdb) puis par l'annee.
//   2) Listes VOD / Series IPTV -> findIptvMatchesByLang (1 entree par langue).
//   3) Services streaming        -> Plex Discover (search universel -> availabilities),
//      memes endpoints upstream que /api/plex/discover/*.
//
// Le statut synthetise le tout : 'in_catalogue' (Plex perso ou IPTV), sinon
// 'streaming_only' (que via services), sinon 'not_found' (-> wishlist).

import { db } from './db.js'
import {
  findIptvMatchesByLang,
  listActiveCredentialIds,
  normalizeTitle,
  type IptvMatch,
} from './iptvVodCache.js'

// ── Types publics ────────────────────────────────────────────────────────────

export interface MatchInput {
  title: string
  year?: number | null
  type: 'movie' | 'show'
  ids?: { tmdb?: number; imdb?: string }
}

// Presence dans la bibliotheque Plex personnelle.
export interface PlexLibraryHit {
  ratingKey: string
  title: string
  year: number | null
  type: string                 // 'movie' | 'show'
  sectionId: string
  // Comment le match a ete confirme : par id externe (le plus fiable) ou par
  // titre normalise + annee.
  matchedBy: 'id' | 'title_year'
}

// Une version IPTV trouvee (par langue).
export interface IptvHit {
  credentialId: number
  kind: 'vod' | 'series'
  streamId: string
  language: string | null
  name: string
}

// Une dispo streaming via Plex Discover.
export interface StreamingHit {
  platform: string            // netflix, disney+, primevideo, ...
  title: string
  url: string                 // deep-link eventuel renvoye par Plex
  offerType: string | null    // subscription | buy | rent | ...
  price: number | null
  quality: string | null
}

export type MatchStatus = 'in_catalogue' | 'streaming_only' | 'not_found'

export interface MatchResult {
  input: MatchInput
  status: MatchStatus
  plex: PlexLibraryHit | null
  iptv: IptvHit[]
  streaming: StreamingHit[]
  // Diagnostics non bloquants (ex. Plex non connecte) pour comprendre un resultat
  // partiel cote appelant.
  notes: string[]
}

// ── Config Plex (lecture directe, meme pattern que resolvePlexWatchUrl) ───────

interface PlexCfg {
  auth_token: string
  server_url: string
}

async function getPlexConfig(): Promise<PlexCfg | null> {
  try {
    const { rows } = await db.execute('SELECT auth_token, server_url FROM plex_config WHERE id = 1')
    const cfg = rows[0] as any
    if (!cfg?.auth_token) return null
    return { auth_token: String(cfg.auth_token), server_url: String(cfg.server_url ?? '') }
  } catch {
    return null
  }
}

// ── Helpers de comparaison ───────────────────────────────────────────────────

function yearClose(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return true     // si une annee manque, on ne disqualifie pas
  return Math.abs(a - b) <= 1
}

function titleEquivalent(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (na.length < 2 || nb.length < 2) return false
  return na === nb || na.startsWith(nb + ' ') || nb.startsWith(na + ' ')
}

// Extrait les ids externes (imdb/tmdb) d'un noeud de metadata Plex. Plex expose
// deux formes selon l'endpoint : un champ `Guid` (tableau d'objets {id}) sur le
// serveur perso, ou un guid unique `plex://...` (Discover). On lit le tableau.
function externalIdsFromPlexMeta(meta: any): { imdb?: string; tmdb?: number } {
  const out: { imdb?: string; tmdb?: number } = {}
  const guids: any[] = Array.isArray(meta?.Guid) ? meta.Guid : []
  for (const g of guids) {
    const id = String(g?.id ?? '')
    const mImdb = id.match(/^imdb:\/\/(tt\d+)/i)
    if (mImdb) out.imdb = mImdb[1]
    const mTmdb = id.match(/^tmdb:\/\/(\d+)/i)
    if (mTmdb) out.tmdb = Number(mTmdb[1])
  }
  return out
}

function idsMatch(
  wanted: MatchInput['ids'],
  found: { imdb?: string; tmdb?: number },
): boolean {
  if (!wanted) return false
  if (wanted.imdb && found.imdb && wanted.imdb.toLowerCase() === found.imdb.toLowerCase()) return true
  if (wanted.tmdb != null && found.tmdb != null && Number(wanted.tmdb) === Number(found.tmdb)) return true
  return false
}

// ── 1) Bibliotheque Plex perso ───────────────────────────────────────────────

interface PlexSection {
  id: string
  type: string                // movie | show | ...
}

async function listPlexSections(cfg: PlexCfg): Promise<PlexSection[]> {
  if (!cfg.server_url) return []
  try {
    const r = await fetch(`${cfg.server_url}/library/sections?X-Plex-Token=${cfg.auth_token}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000) as any,
    })
    if (!r.ok) return []
    const data: any = await r.json()
    return (data?.MediaContainer?.Directory ?? []).map((d: any) => ({
      id: String(d.key),
      type: String(d.type),
    }))
  } catch {
    return []
  }
}

// Cherche un titre dans une section Plex et renvoie les metadata candidats (avec
// leurs Guid externes pour la verification par id).
async function searchPlexSection(
  cfg: PlexCfg,
  sectionId: string,
  title: string,
): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      'X-Plex-Token': cfg.auth_token,
      'X-Plex-Container-Size': '30',
      title,
    })
    const r = await fetch(`${cfg.server_url}/library/sections/${sectionId}/all?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000) as any,
    })
    if (!r.ok) return []
    const data: any = await r.json()
    return data?.MediaContainer?.Metadata ?? []
  } catch {
    return []
  }
}

// Resout la presence dans la bibliotheque Plex perso. Priorite au match par id
// externe (imdb/tmdb via les Guid), repli sur titre normalise + annee.
async function matchPlexLibrary(
  cfg: PlexCfg | null,
  input: MatchInput,
  notes: string[],
): Promise<PlexLibraryHit | null> {
  if (!cfg) { notes.push('plex_not_connected'); return null }
  if (!cfg.server_url) { notes.push('plex_no_server_url'); return null }

  const wantType = input.type === 'show' ? 'show' : 'movie'
  const sections = (await listPlexSections(cfg)).filter(s => s.type === wantType)
  if (sections.length === 0) { notes.push('plex_no_matching_section'); return null }

  let titleFallback: { meta: any; sectionId: string } | null = null

  for (const sec of sections) {
    const metas = await searchPlexSection(cfg, sec.id, input.title)
    for (const meta of metas) {
      const ext = externalIdsFromPlexMeta(meta)
      // 1) Match par id externe : le plus fiable, on retourne immediatement.
      if (idsMatch(input.ids, ext)) {
        return {
          ratingKey: String(meta.ratingKey),
          title: String(meta.title ?? input.title),
          year: typeof meta.year === 'number' ? meta.year : null,
          type: String(meta.type ?? wantType),
          sectionId: sec.id,
          matchedBy: 'id',
        }
      }
      // 2) Repli titre + annee : on memorise le premier candidat plausible mais on
      //    continue a chercher un meilleur match par id.
      if (!titleFallback && titleEquivalent(meta.title ?? '', input.title)) {
        const metaYear = typeof meta.year === 'number' ? meta.year : null
        if (wantType === 'show' || yearClose(metaYear, input.year ?? null)) {
          titleFallback = { meta, sectionId: sec.id }
        }
      }
    }
  }

  if (titleFallback) {
    const meta = titleFallback.meta
    return {
      ratingKey: String(meta.ratingKey),
      title: String(meta.title ?? input.title),
      year: typeof meta.year === 'number' ? meta.year : null,
      type: String(meta.type ?? wantType),
      sectionId: titleFallback.sectionId,
      matchedBy: 'title_year',
    }
  }

  return null
}

// ── 2) IPTV ──────────────────────────────────────────────────────────────────

async function matchIptv(input: MatchInput): Promise<IptvHit[]> {
  // Pour une serie, l'annee n'est pas pertinente (cf. findIptvMatchesByLang qui
  // l'ignore deja pour les series). Pour un film on passe l'annee.
  const year = input.type === 'movie' ? (input.year ?? undefined) : undefined
  const out: IptvHit[] = []
  for (const credId of await listActiveCredentialIds()) {
    let matches: IptvMatch[] = []
    try {
      matches = await findIptvMatchesByLang(credId, input.title, year)
    } catch {
      matches = []
    }
    for (const m of matches) {
      out.push({
        credentialId: credId,
        kind: m.kind,
        streamId: m.entry.stream_id,
        language: m.entry.language ?? null,
        name: m.entry.name,
      })
    }
  }
  return out
}

// ── 3) Services streaming via Plex Discover ──────────────────────────────────

// Cherche le titre dans Plex Discover et renvoie le ratingKey du meilleur
// candidat (verifie par id externe si possible, sinon titre + annee + type).
async function findDiscoverRatingKey(
  cfg: PlexCfg,
  input: MatchInput,
): Promise<string | null> {
  try {
    const url = `https://discover.provider.plex.tv/library/search?query=${encodeURIComponent(input.title)}&searchTypes=movies,tv&searchProviders=discover&includeMetadata=1&X-Plex-Token=${cfg.auth_token}`
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000) as any,
    })
    if (!r.ok) return null
    const data: any = await r.json()

    const wantType = input.type === 'show' ? 'show' : 'movie'
    let titleFallback: string | null = null

    for (const sec of (data?.MediaContainer?.SearchResults ?? [])) {
      for (const sr of (sec.SearchResult ?? [])) {
        const m = sr.Metadata
        if (!m?.ratingKey) continue
        if (m.type !== wantType) continue

        // Le guid Discover est de la forme plex://movie/<hash> et ne porte pas
        // l'imdb/tmdb directement ; on tente quand meme via Guid[] si present.
        const ext = externalIdsFromPlexMeta(m)
        if (idsMatch(input.ids, ext)) return String(m.ratingKey)

        if (!titleFallback && titleEquivalent(m.title ?? '', input.title)) {
          const y = typeof m.year === 'number' ? m.year : null
          if (wantType === 'show' || yearClose(y, input.year ?? null)) {
            titleFallback = String(m.ratingKey)
          }
        }
      }
    }
    return titleFallback
  } catch {
    return null
  }
}

// Recupere les dispos streaming d'un ratingKey Discover (memes donnees que
// /api/plex/discover/:ratingKey/availabilities, sans le cross-ref IPTV qu'on
// gere separement). On exclut explicitement les entrees iptv (il n'y en a pas
// ici de toute facon).
async function fetchDiscoverAvailabilities(
  cfg: PlexCfg,
  ratingKey: string,
): Promise<StreamingHit[]> {
  try {
    const url = `https://metadata.provider.plex.tv/library/metadata/${ratingKey}/availabilities?X-Plex-Token=${cfg.auth_token}`
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000) as any,
    })
    if (!r.ok) return []
    const data: any = await r.json()
    return (data?.MediaContainer?.Availability ?? []).map((a: any): StreamingHit => ({
      platform: String(a.platform ?? ''),
      title: String(a.title ?? ''),
      url: String(a.url ?? ''),
      offerType: a.offerType != null ? String(a.offerType) : null,
      price: typeof a.price === 'number' ? a.price : null,
      quality: a.quality != null ? String(a.quality) : null,
    }))
  } catch {
    return []
  }
}

async function matchStreaming(
  cfg: PlexCfg | null,
  input: MatchInput,
  notes: string[],
): Promise<StreamingHit[]> {
  if (!cfg) return []
  const ratingKey = await findDiscoverRatingKey(cfg, input)
  if (!ratingKey) { notes.push('discover_no_match'); return [] }
  return fetchDiscoverAvailabilities(cfg, ratingKey)
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function matchCatalogue(input: MatchInput): Promise<MatchResult> {
  const notes: string[] = []
  const cfg = await getPlexConfig()

  // Les trois sources sont independantes : on les lance en parallele.
  const [plex, iptv, streaming] = await Promise.all([
    matchPlexLibrary(cfg, input, notes),
    matchIptv(input),
    matchStreaming(cfg, input, notes),
  ])

  let status: MatchStatus
  if (plex || iptv.length > 0) status = 'in_catalogue'
  else if (streaming.length > 0) status = 'streaming_only'
  else status = 'not_found'

  return { input, status, plex, iptv, streaming, notes }
}
