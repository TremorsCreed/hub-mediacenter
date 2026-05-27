// Cache mémoire des listes Xtream (VOD + Live) par credential.
// TTL 1h. Premier fetch lent (~5-30s pour ~100k VOD), suivants instantanés.
// Sert au Catalog IPTV (Local) et au cross-ref Discover.

import { db } from './db.js'

export interface StreamEntry {
  stream_id: string
  name: string
  year: string
  logo?: string
  category_id: string
  added?: string
  rating?: string
  language?: string  // code ISO simplifié ('FR', 'EN', 'DE', ...) ou undefined
}

// Détecte la langue à partir des préfixes courants des providers IPTV.
// "FR | Canal+ HD", "[EN] Netflix VOD", "VF - Titanic (1997)", etc.
export function detectLanguage(name: string): string | undefined {
  if (!name) return undefined
  const m = name.match(/^\s*[\[\(]?\s*(VF|VFF|VFQ|VOSTFR|VO|FR|EN|US|UK|DE|ES|IT|NL|PT|BR|RU|TR|AR|PL|JP|KO|CN|TW|GR|RO|HU|CZ|MULTI)\s*[\]\)]?\s*[|:\-—–·]/i)
  if (!m) return undefined
  const code = m[1].toUpperCase()
  if (code === 'VF' || code === 'VFF' || code === 'VFQ') return 'FR'
  if (code === 'VOSTFR') return 'FR'  // sous-titres FR
  if (code === 'VO' || code === 'US' || code === 'UK') return 'EN'
  if (code === 'BR') return 'PT'
  if (code === 'TW') return 'CN'
  return code
}

type Kind = 'vod' | 'live' | 'series'

interface CacheEntry {
  items: StreamEntry[]
  loadedAt: number
  inFlight?: Promise<StreamEntry[]>
}

const TTL_MS = 60 * 60 * 1000
const cache = new Map<string, CacheEntry>()  // key = "vod:credId" ou "live:credId"

function key(kind: Kind, credId: number) { return `${kind}:${credId}` }

async function fetchCred(credId: number) {
  const { rows } = await db.execute({
    sql: "SELECT data FROM credentials WHERE id = ? AND type = 'xtream'",
    args: [credId]
  })
  if (!rows.length) return null
  const data = JSON.parse((rows[0] as any).data as string)
  if (!data.server || !data.user || !data.pass) return null
  return {
    server: String(data.server).replace(/\/+$/, '').trim(),
    user: String(data.user).trim(),
    pass: String(data.pass).trim(),
  }
}

async function fetchAll(credId: number, kind: Kind): Promise<StreamEntry[]> {
  const cred = await fetchCred(credId)
  if (!cred) return []
  const action = kind === 'vod' ? 'get_vod_streams'
                : kind === 'series' ? 'get_series'
                : 'get_live_streams'
  const url = `${cred.server}/player_api.php?username=${encodeURIComponent(cred.user)}&password=${encodeURIComponent(cred.pass)}&action=${action}`
  console.log(`[iptv-cache] fetching ${kind} list for credential #${credId}...`)
  const t0 = Date.now()
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) } as any)
    if (!r.ok) { console.warn(`[iptv-cache] fetch ${kind} ${credId} returned ${r.status}`); return [] }
    const data = await r.json() as any[]
    const items: StreamEntry[] = (data ?? []).map(s => {
      const name = String(s.name ?? '')
      // Pour les séries Xtream, l'identifiant principal est series_id (pas stream_id)
      const id = kind === 'series' ? String(s.series_id ?? s.num ?? s.stream_id ?? '') : String(s.stream_id)
      return {
        stream_id: id,
        name,
        year: String(s.releaseDate ?? s.year ?? ''),
        logo: (s.cover || s.stream_icon) as string | undefined,
        category_id: String(s.category_id ?? ''),
        added: (s.last_modified ?? s.added) as string | undefined,
        rating: s.rating as string | undefined,
        language: detectLanguage(name),
      }
    })
    console.log(`[iptv-cache] cached ${items.length} ${kind} items for credential #${credId} in ${Date.now() - t0}ms`)
    return items
  } catch (e) {
    console.warn(`[iptv-cache] fetch ${kind} ${credId} failed:`, (e as Error).message)
    return []
  }
}

export async function getList(credId: number, kind: Kind): Promise<StreamEntry[]> {
  const k = key(kind, credId)
  const now = Date.now()
  const c = cache.get(k)
  if (c && (now - c.loadedAt) < TTL_MS) return c.items
  if (c?.inFlight) return c.inFlight
  const promise = fetchAll(credId, kind).then(items => {
    cache.set(k, { items, loadedAt: Date.now() })
    return items
  })
  cache.set(k, { items: c?.items ?? [], loadedAt: c?.loadedAt ?? 0, inFlight: promise })
  return promise
}

export const getVodList = (credId: number) => getList(credId, 'vod')
export const getLiveList = (credId: number) => getList(credId, 'live')
export const getSeriesList = (credId: number) => getList(credId, 'series')

export function normalizeTitle(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(fr|en|de|es|it|nl|pl|vf|vo|vostfr|multi)\s*[|:\-]\s*/i, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findAllInList(list: StreamEntry[], title: string, year?: number): StreamEntry[] {
  if (list.length === 0) return []
  const target = normalizeTitle(title)
  if (target.length < 3) return []
  const candidates = list.filter(v => {
    const n = normalizeTitle(v.name)
    return n === target || n.startsWith(target + ' ') || n.endsWith(' ' + target) || n.includes(' ' + target + ' ')
  })
  if (!year) return candidates
  // Filtrer par année quand fournie (films surtout — pas applicable aux séries)
  const yearMatch = candidates.filter(v => {
    if (!v.year) return true
    if (v.year.startsWith(String(year))) return true
    const y = parseInt(v.year)
    return y && Math.abs(y - year) <= 1
  })
  return yearMatch.length > 0 ? yearMatch : candidates
}

function findInList(list: StreamEntry[], title: string, year?: number): StreamEntry | null {
  return findAllInList(list, title, year)[0] ?? null
}

// Dédup par langue : 1 résultat par langue détectée (les items sans langue
// taggée "??" sont gardés tous mais limités).
function dedupByLanguage<T extends { entry: StreamEntry }>(matches: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const m of matches) {
    const lang = m.entry.language ?? '??'
    if (seen.has(lang)) continue
    seen.add(lang)
    out.push(m)
  }
  return out
}

// VOD uniquement (compatibilité, mais préférer findIptvMatch pour le cross-ref Discover)
export async function findIptvVodMatch(credId: number, title: string, year?: number): Promise<StreamEntry | null> {
  return findInList(await getVodList(credId), title, year)
}

// Cherche dans VOD ET series. Pour les séries on ignore l'année (une série dure
// plusieurs années, ce qui ferait échouer le matching).
export interface IptvMatch {
  kind: 'vod' | 'series'
  entry: StreamEntry
}

export async function findIptvMatch(credId: number, title: string, year?: number): Promise<IptvMatch | null> {
  const seriesMatch = findInList(await getSeriesList(credId), title)
  if (seriesMatch) return { kind: 'series', entry: seriesMatch }
  const vodMatch = findInList(await getVodList(credId), title, year)
  if (vodMatch) return { kind: 'vod', entry: vodMatch }
  return null
}

// Variante qui retourne plusieurs matches : 1 par langue détectée.
// Utilisé par Discover pour afficher "IPTV (Série) FR" + "IPTV (Série) EN" côte à côte.
export async function findIptvMatchesByLang(credId: number, title: string, year?: number): Promise<IptvMatch[]> {
  const seriesMatches = findAllInList(await getSeriesList(credId), title).map(entry => ({ kind: 'series' as const, entry }))
  if (seriesMatches.length > 0) return dedupByLanguage(seriesMatches)
  const vodMatches = findAllInList(await getVodList(credId), title, year).map(entry => ({ kind: 'vod' as const, entry }))
  return dedupByLanguage(vodMatches)
}

export async function listActiveCredentialIds(): Promise<number[]> {
  const { rows } = await db.execute("SELECT id FROM credentials WHERE type = 'xtream'")
  return rows.map((r: any) => Number(r.id))
}

// Précharge VOD + Live + Series au démarrage backend (fire-and-forget).
export async function preloadAll() {
  const ids = await listActiveCredentialIds()
  for (const id of ids) {
    getVodList(id).catch(() => {})
    getLiveList(id).catch(() => {})
    getSeriesList(id).catch(() => {})
  }
  if (ids.length) console.log(`[iptv-cache] preloading ${ids.length} credential(s) (vod + live + series)...`)
}

// Invalide les caches d'un credential (à appeler quand on update/delete une credential)
export function invalidate(credId: number) {
  cache.delete(key('vod', credId))
  cache.delete(key('live', credId))
  cache.delete(key('series', credId))
}
