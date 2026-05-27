// Cache mémoire des listes VOD Xtream par credential.
// TTL 1h. Premier fetch ~5-30s (250K films chez Elon IPTV), suivants instantanés.
// Sert au cross-ref Discover : on signale "ce film est aussi dans ton IPTV".

import { db } from './db.js'

export interface VodEntry {
  stream_id: string
  name: string
  year: string  // peut être "2010" ou "2010-09-14" selon le provider
  logo?: string
}

interface CacheEntry {
  items: VodEntry[]
  loadedAt: number
  inFlight?: Promise<VodEntry[]>
}

const TTL_MS = 60 * 60 * 1000  // 1h
const cache = new Map<number, CacheEntry>()

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

async function fetchAllVod(credId: number): Promise<VodEntry[]> {
  const cred = await fetchCred(credId)
  if (!cred) return []
  const url = `${cred.server}/player_api.php?username=${encodeURIComponent(cred.user)}&password=${encodeURIComponent(cred.pass)}&action=get_vod_streams`
  console.log(`[iptv-vod] fetching VOD list for credential #${credId}...`)
  const t0 = Date.now()
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) } as any)
    if (!r.ok) { console.warn(`[iptv-vod] fetch ${credId} returned ${r.status}`); return [] }
    const data = await r.json() as any[]
    const items: VodEntry[] = (data ?? []).map(s => ({
      stream_id: String(s.stream_id),
      name: String(s.name ?? ''),
      year: String(s.releaseDate ?? s.year ?? ''),
      logo: (s.stream_icon || s.cover) as string | undefined,
    }))
    console.log(`[iptv-vod] cached ${items.length} VOD items for credential #${credId} in ${Date.now() - t0}ms`)
    return items
  } catch (e) {
    console.warn(`[iptv-vod] fetch ${credId} failed:`, (e as Error).message)
    return []
  }
}

export async function getVodList(credId: number): Promise<VodEntry[]> {
  const now = Date.now()
  const c = cache.get(credId)
  if (c && (now - c.loadedAt) < TTL_MS) return c.items
  if (c?.inFlight) return c.inFlight
  const promise = fetchAllVod(credId).then(items => {
    cache.set(credId, { items, loadedAt: Date.now() })
    return items
  })
  cache.set(credId, { items: c?.items ?? [], loadedAt: c?.loadedAt ?? 0, inFlight: promise })
  return promise
}

// Normalise un titre pour matching : minuscules, sans accents/ponctuation,
// sans préfixes de langue communs des providers IPTV ("FR|", "VF -", etc.).
export function normalizeTitle(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(fr|en|de|es|it|nl|pl|vf|vo|vostfr|multi)\s*[|:\-]\s*/i, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function findIptvVodMatch(credId: number, title: string, year?: number): Promise<VodEntry | null> {
  const list = await getVodList(credId)
  if (list.length === 0) return null
  const target = normalizeTitle(title)
  if (target.length < 3) return null

  // Pass 1 : matches potentiels par titre normalisé
  const candidates = list.filter(v => {
    const n = normalizeTitle(v.name)
    return n === target || n.startsWith(target + ' ') || n.endsWith(' ' + target) || n.includes(' ' + target + ' ')
  })
  if (candidates.length === 0) return null

  // Pass 2 : disambiguation par année si fournie
  if (year) {
    const exact = candidates.find(v => v.year.startsWith(String(year)))
    if (exact) return exact
    const close = candidates.find(v => {
      const y = parseInt(v.year)
      return y && Math.abs(y - year) <= 1
    })
    if (close) return close
  }
  return candidates[0]
}

export async function listActiveCredentialIds(): Promise<number[]> {
  const { rows } = await db.execute("SELECT id FROM credentials WHERE type = 'xtream'")
  return rows.map((r: any) => Number(r.id))
}

// Précharge tous les VOD en arrière-plan (fire-and-forget).
// Appelée au démarrage backend — le premier search Discover ne paie pas le coût.
export async function preloadAll() {
  const ids = await listActiveCredentialIds()
  for (const id of ids) {
    getVodList(id).catch(() => {})  // déclenche le fetch sans attendre
  }
  if (ids.length) console.log(`[iptv-vod] preloading ${ids.length} credential(s)...`)
}
