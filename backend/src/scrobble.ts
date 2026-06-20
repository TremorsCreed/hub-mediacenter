import { db } from './db'
import { traktFetch } from './routes/traktAuth'

// ── Scrobbling Trakt (Plex v1) ───────────────────────────────────────────────
// On interroge périodiquement les sessions Plex (/status/sessions, source de vérité)
// et on pousse start/pause/stop vers Trakt pour le profil qui regarde. 100% backend,
// aucun changement agent. Gaté : no-op si le profil n'a pas lié de compte Trakt.
// IPTV non couvert ici (pas d'ID fiable) — à ajouter plus tard via recherche par titre.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface ActiveScrobble { ratingKey: string; action: 'start' | 'pause'; progress: number; userId: number; meta: any }
const active = new Map<string, ActiveScrobble>() // clé = device_id

async function plexConfig(): Promise<{ auth_token: string; server_url: string } | null> {
  const { rows } = await db.execute('SELECT auth_token, server_url FROM plex_config WHERE id = 1')
  const c = rows[0] as any
  return c?.auth_token && c?.server_url ? c : null
}

async function deviceForIp(ip: string): Promise<string | null> {
  const { rows } = await db.execute({ sql: 'SELECT id FROM devices WHERE ip = ?', args: [ip] })
  return (rows[0] as any)?.id ?? null
}

// Profil qui regarde sur ce device : le plus récent à avoir lancé une lecture (historique).
async function userForDevice(deviceId: string): Promise<number | null> {
  const { rows } = await db.execute({
    sql: 'SELECT user_id FROM playback_history WHERE device_id = ? AND user_id IS NOT NULL ORDER BY started_at DESC LIMIT 1',
    args: [deviceId],
  })
  const u = (rows[0] as any)?.user_id
  return u != null ? Number(u) : null
}

async function hasTrakt(userId: number): Promise<boolean> {
  const { rows } = await db.execute({ sql: 'SELECT 1 FROM trakt_accounts WHERE user_id = ?', args: [userId] })
  return rows.length > 0
}

async function getPlexMeta(rk: string): Promise<any | null> {
  const cfg = await plexConfig()
  if (!cfg) return null
  try {
    const r = await fetch(`${cfg.server_url}/library/metadata/${rk}?X-Plex-Token=${cfg.auth_token}`,
      { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(5000) as any })
    if (!r.ok) return null
    const d: any = await r.json()
    return d?.MediaContainer?.Metadata?.[0] ?? null
  } catch { return null }
}

// Extrait les IDs externes (imdb/tmdb/tvdb) des Guid Plex.
function guids(m: any): Record<string, any> {
  const out: Record<string, any> = {}
  for (const g of m?.Guid ?? []) {
    const s = String(g.id || '')
    if (s.startsWith('imdb://')) out.imdb = s.slice(7)
    else if (s.startsWith('tmdb://')) out.tmdb = Number(s.slice(7))
    else if (s.startsWith('tvdb://')) out.tvdb = Number(s.slice(7))
  }
  return out
}

// Construit le corps de scrobble Trakt depuis la métadonnée Plex.
function traktBody(m: any, progress: number): any {
  const ids = guids(m)
  if (m.type === 'episode') {
    if (Object.keys(ids).length) return { episode: { ids }, progress }
    return { show: { title: m.grandparentTitle }, episode: { season: m.parentIndex, number: m.index }, progress }
  }
  if (ids.imdb || ids.tmdb) return { movie: { ids }, progress }
  return { movie: { title: m.title, year: m.year }, progress }
}

async function scrobble(action: 'start' | 'pause' | 'stop', st: ActiveScrobble): Promise<void> {
  try {
    const body = traktBody(st.meta, st.progress)
    const r = await traktFetch(st.userId, `/scrobble/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    console.log(`[trakt] scrobble ${action} rk=${st.ratingKey} ${st.progress}% user=${st.userId} -> ${r.status}`)
  } catch (e: any) {
    console.error('[trakt] scrobble error:', e.message)
  }
}

async function poll(): Promise<void> {
  const cfg = await plexConfig()
  if (!cfg) return
  let sessions: any[] = []
  try {
    const r = await fetch(`${cfg.server_url}/status/sessions?X-Plex-Token=${cfg.auth_token}`,
      { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(5000) as any })
    if (!r.ok) return
    const j: any = await r.json()
    sessions = j?.MediaContainer?.Metadata ?? []
  } catch { return }

  const seen = new Set<string>()
  for (const s of sessions) {
    const ip = s.Player?.address as string | undefined
    if (!ip) continue
    const deviceId = await deviceForIp(ip)
    if (!deviceId) continue
    const userId = await userForDevice(deviceId)
    if (userId == null || !(await hasTrakt(userId))) continue
    const rk = s.ratingKey ? String(s.ratingKey) : ''
    if (!rk) continue
    seen.add(deviceId)

    const progress = Number(s.duration) > 0 ? Math.min(100, Math.round((Number(s.viewOffset || 0) / Number(s.duration)) * 100)) : 0
    const wantAction: 'start' | 'pause' = s.Player?.state === 'paused' ? 'pause' : 'start'

    const prev = active.get(deviceId)
    // Média changé sur ce device → on clôt l'ancien d'abord.
    if (prev && prev.ratingKey !== rk) { await scrobble('stop', prev); active.delete(deviceId) }

    const cur = active.get(deviceId)
    if (!cur || cur.ratingKey !== rk || cur.action !== wantAction) {
      const meta = await getPlexMeta(rk)
      if (!meta) continue
      const st: ActiveScrobble = { ratingKey: rk, action: wantAction, progress, userId, meta }
      await scrobble(wantAction, st)
      active.set(deviceId, st)
    } else {
      cur.progress = progress // tient la progression à jour pour le stop final
    }
  }

  // Sessions disparues depuis le dernier passage → stop (≥80% = vu côté Trakt).
  for (const [deviceId, st] of [...active]) {
    if (!seen.has(deviceId)) { await scrobble('stop', st); active.delete(deviceId) }
  }
}

export function startScrobbler(): void {
  setInterval(() => { poll().catch(() => {}) }, 30_000)
  console.log('[trakt] scrobbler démarré (sessions Plex, 30s)')
}
