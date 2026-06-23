import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'

// ── OAuth Trakt par profil (device flow, idéal TV) ───────────────────────────
// Le token « suit le profil actif » (même design que Spotify). Sert au scrobbling
// universel, au « prochain épisode » multi-sources et à la publication de listes.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const TRAKT_API = 'https://api.trakt.tv'

interface TraktAppConfig { client_id: string; client_secret: string }

async function getAppConfig(): Promise<TraktAppConfig | null> {
  const { rows } = await db.execute("SELECT data FROM credentials WHERE type = 'trakt_app' ORDER BY id LIMIT 1")
  if (rows.length) {
    const data = JSON.parse((rows[0] as any).data as string)
    if (data.client_id && data.client_secret) return { client_id: data.client_id, client_secret: data.client_secret }
  }
  const id = process.env.TRAKT_CLIENT_ID, secret = process.env.TRAKT_CLIENT_SECRET
  if (id && secret) return { client_id: id, client_secret: secret }
  return null
}

function authHeaders(token: string, clientId: string) {
  return { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': clientId, 'User-Agent': UA, Authorization: `Bearer ${token}` }
}

// ── Stockage / rafraîchissement des tokens ───────────────────────────────────
interface TraktAccountRow {
  user_id: number; username: string | null; name: string | null
  access_token: string; refresh_token: string; expires_at: number
}

async function getAccountRow(userId: number): Promise<TraktAccountRow | null> {
  const { rows } = await db.execute({ sql: 'SELECT * FROM trakt_accounts WHERE user_id = ?', args: [userId] })
  return (rows[0] as any) ?? null
}

// Access token valide pour un profil, rafraîchi si proche de l'expiration.
async function getAccessToken(userId: number): Promise<string | null> {
  const row = await getAccountRow(userId)
  if (!row) return null
  if (Date.now() < row.expires_at - 60_000) return row.access_token
  const cfg = await getAppConfig()
  if (!cfg) return null
  const r = await fetch(`${TRAKT_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      refresh_token: row.refresh_token, client_id: cfg.client_id, client_secret: cfg.client_secret,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) { console.error('[trakt] refresh failed:', r.status); return null }
  const d: any = await r.json()
  const expiresAt = (Number(d.created_at ?? Math.floor(Date.now() / 1000)) + Number(d.expires_in ?? 7776000)) * 1000
  await db.execute({
    sql: 'UPDATE trakt_accounts SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE user_id = ?',
    args: [d.access_token, d.refresh_token || row.refresh_token, expiresAt, Date.now(), userId],
  })
  return d.access_token as string
}

// Appel authentifié à l'API Trakt pour le compte d'un profil (helper pour le scrobbling).
export async function traktFetch(userId: number, path: string, init: RequestInit = {}): Promise<Response> {
  const cfg = await getAppConfig()
  const token = await getAccessToken(userId)
  if (!cfg || !token) throw new Error('no_trakt_account')
  return fetch(`${TRAKT_API}${path}`, { ...init, headers: { ...authHeaders(token, cfg.client_id), ...(init.headers || {}) } })
}
export { getAccessToken as getTraktAccessToken }

// Récupère et persiste le profil Trakt après liaison.
async function fetchAndStoreProfile(userId: number, token: string, cfg: TraktAppConfig, scope: string, expiresAt: number) {
  let username = '', name = '', image = '', traktId = ''
  try {
    const me = await fetch(`${TRAKT_API}/users/me?extended=full`, { headers: authHeaders(token, cfg.client_id) })
    if (me.ok) {
      const u: any = await me.json()
      username = u.username ?? ''
      name = u.name ?? u.username ?? ''
      traktId = String(u.ids?.slug ?? '')
      image = u.images?.avatar?.full ?? ''
    }
  } catch { /* profil non bloquant */ }
  const now = Date.now()
  await db.execute({
    sql: `INSERT INTO trakt_accounts (user_id, trakt_user_id, username, name, access_token, refresh_token, expires_at, scopes, image, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            trakt_user_id = excluded.trakt_user_id, username = excluded.username, name = excluded.name,
            access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
            scopes = excluded.scopes, image = excluded.image, updated_at = excluded.updated_at`,
    args: [userId, traktId, username, name, token, '', expiresAt, scope, image, now, now],
  })
  return { username, name, image }
}

// ── Sessions device-flow en attente (device_code → profil cible) ─────────────
interface PendingDevice { user_id: number; expires: number }
const pending = new Map<string, PendingDevice>()
function gcPending() { const now = Date.now(); for (const [k, v] of pending) if (v.expires < now) pending.delete(k) }

const router = Router()

// Statut : app configurée ? comptes liés ?
router.get('/auth/status', async (_req, res) => {
  const cfg = await getAppConfig()
  const { rows } = await db.execute('SELECT user_id, username, name, image FROM trakt_accounts')
  res.json({
    app_configured: !!cfg,
    accounts: rows.map((r: any) => ({ user_id: r.user_id, username: r.username, name: r.name, image: r.image })),
  })
})

// Démarre le device flow : renvoie user_code + verification_url à afficher.
router.post('/auth/device/start', async (req, res) => {
  const cfg = await getAppConfig()
  if (!cfg) return res.status(400).json({ error: 'trakt_app_not_configured' })
  const userId = req.query.user_id !== undefined ? parseInt(String(req.query.user_id), 10) : (req as any).userId
  if (userId === null || userId === undefined || !Number.isFinite(userId)) return res.status(400).json({ error: 'user_id_required' })
  const r = await fetch(`${TRAKT_API}/oauth/device/code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ client_id: cfg.client_id }),
  })
  if (!r.ok) return res.status(502).json({ error: 'device_code_failed' })
  const d: any = await r.json()
  gcPending()
  pending.set(d.device_code, { user_id: userId, expires: Date.now() + Number(d.expires_in ?? 600) * 1000 })
  res.json({ device_code: d.device_code, user_code: d.user_code, verification_url: d.verification_url, interval: d.interval ?? 5, expires_in: d.expires_in ?? 600 })
})

// Poll : le front rappelle toutes les `interval`s jusqu'à liaison.
router.post('/auth/device/poll', async (req, res) => {
  const parsed = z.object({ device_code: z.string().min(8) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'device_code requis' })
  const cfg = await getAppConfig()
  if (!cfg) return res.status(400).json({ error: 'trakt_app_not_configured' })
  gcPending()
  const p = pending.get(parsed.data.device_code)
  if (!p) return res.json({ status: 'expired' })
  const r = await fetch(`${TRAKT_API}/oauth/device/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ code: parsed.data.device_code, client_id: cfg.client_id, client_secret: cfg.client_secret }),
  })
  if (r.status === 400) return res.json({ status: 'pending' })
  if (r.status === 404) return res.json({ status: 'error' })
  if (r.status === 409) return res.json({ status: 'linked' }) // déjà utilisé
  if (r.status === 410) { pending.delete(parsed.data.device_code); return res.json({ status: 'expired' }) }
  if (r.status === 418) { pending.delete(parsed.data.device_code); return res.json({ status: 'denied' }) }
  if (r.status === 429) return res.json({ status: 'pending' }) // slow down
  if (!r.ok) return res.json({ status: 'error' })
  const tok: any = await r.json()
  const expiresAt = (Number(tok.created_at ?? Math.floor(Date.now() / 1000)) + Number(tok.expires_in ?? 7776000)) * 1000
  const prof = await fetchAndStoreProfile(p.user_id, tok.access_token, cfg, tok.scope ?? '', expiresAt)
  // refresh_token réel (l'INSERT initial a mis ''), on le met à jour.
  await db.execute({ sql: 'UPDATE trakt_accounts SET refresh_token = ? WHERE user_id = ?', args: [tok.refresh_token ?? '', p.user_id] })
  pending.delete(parsed.data.device_code)
  console.log(`[trakt] linked ${prof.username || '?'} → profil ${p.user_id}`)
  res.json({ status: 'linked', profile: prof })
})

// Historique « vu » du profil (films + séries/épisodes) pour marquer auto les playlists.
// Renvoie titres+années (matching côté client par titre, les items Hub n'ont pas d'ID).
router.get('/watched', async (req, res) => {
  const userId = req.query.user_id !== undefined ? parseInt(String(req.query.user_id), 10) : (req as any).userId
  if (userId == null || !Number.isFinite(userId)) return res.json({ movies: [], shows: [] })
  if (!(await getAccountRow(userId))) return res.json({ movies: [], shows: [] })
  try {
    const [mr, sr] = await Promise.all([
      traktFetch(userId, '/sync/watched/movies'),
      traktFetch(userId, '/sync/watched/shows'),
    ])
    const moviesRaw = (mr.ok ? await mr.json() : []) as any[]
    const showsRaw = (sr.ok ? await sr.json() : []) as any[]
    const movies = moviesRaw
      .map(x => ({ title: x.movie?.title, year: x.movie?.year ?? null }))
      .filter(m => m.title)
    const shows = showsRaw
      .map(x => ({
        title: x.show?.title,
        year: x.show?.year ?? null,
        // clés "saison-épisode" vues, pour matcher les items épisode des playlists.
        episodes: (x.seasons ?? []).flatMap((se: any) => (se.episodes ?? []).map((e: any) => `${se.number}-${e.number}`)),
      }))
      .filter(s => s.title)
    res.json({ movies, shows })
  } catch (e: any) {
    res.status(502).json({ error: `Trakt indisponible : ${e.message}` })
  }
})

// ── Publication d'une playlist Hub vers une liste Trakt ──────────────────────
// Nos items portent des IDs Plex/IPTV, pas Trakt : on re-résout chaque titre vers
// un ID Trakt via /search (films, séries, épisodes) avant de créer la liste et d'y
// verser les items en un seul POST batch.

const tnorm = (s?: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// Cherche le meilleur match Trakt pour un titre (+ année), renvoie ses ids ({trakt,…}).
// Lance sur erreur API (token/app/réseau) pour la distinguer d'un titre introuvable
// (renvoie null) — sinon une panne d'auth ressemble à « aucun titre trouvé ».
async function searchTraktIds(userId: number, kind: 'movie' | 'show', title: string, year?: number | null): Promise<any | null> {
  const q = encodeURIComponent(title)
  const yr = year ? `&years=${year}` : ''
  const r = await traktFetch(userId, `/search/${kind}?query=${q}${yr}&limit=5`)
  if (!r.ok) throw new Error(`trakt_search_${r.status}`)
  const arr = (await r.json()) as any[]
  if (!Array.isArray(arr) || !arr.length) return null
  // Priorité à un titre normalisé identique, sinon le 1er résultat (déjà trié par score).
  const exact = arr.find(x => tnorm(x[kind]?.title) === tnorm(title))
  return (exact ?? arr[0])?.[kind]?.ids ?? null
}

const PushSchema = z.object({
  playlist_id: z.number().int().positive(),
  privacy: z.enum(['private', 'friends', 'public']).optional(),
})
router.post('/lists/push', async (req, res) => {
  const userId = req.query.user_id !== undefined ? parseInt(String(req.query.user_id), 10) : (req as any).userId
  if (userId == null || !Number.isFinite(userId)) return res.status(400).json({ error: 'user_id_required' })
  if (!(await getAppConfig())) return res.status(400).json({ error: 'Trakt non configuré : client_id/secret de l\'app manquants côté serveur.' })
  const acc = await getAccountRow(userId)
  if (!acc) return res.status(400).json({ error: 'no_trakt_account' })
  const parsed = PushSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'playlist_id requis' })

  const { rows: plRows } = await db.execute({ sql: 'SELECT * FROM playlists WHERE id = ?', args: [parsed.data.playlist_id] })
  const pl = plRows[0] as any
  if (!pl) return res.status(404).json({ error: 'playlist_introuvable' })
  if (pl.owner_user_id !== userId) return res.status(403).json({ error: 'forbidden' })
  const { rows: items } = await db.execute({ sql: 'SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position, id', args: [pl.id] })

  // ── Résolution titre → ID Trakt (séquentiel : on reste sous le rate-limit Trakt) ──
  const movies: any[] = [], shows: any[] = [], episodes: any[] = []
  const missing: string[] = []
  let apiErrors = 0
  for (const raw of items) {
    const it = raw as any
    const title = (it.title as string) || ''
    if (!title || it.status === 'missing') { if (title) missing.push(title); continue }
    // Un titre au format « Show · S01E02 · Titre épisode » est un épisode même si le
    // ref_type stocké dit « series » (selon la source d'import) → on se fie au motif.
    const se = title.match(/s(\d{1,2})e(\d{1,3})/i)
    const isEpisode = it.ref_type === 'episode' || (!!se && title.includes('·'))
    try {
      if (isEpisode && se) {
        const showTitle = title.split('·')[0].trim()
        const showIds = await searchTraktIds(userId, 'show', showTitle, it.year)
        if (showIds?.trakt) {
          const er = await traktFetch(userId, `/shows/${showIds.trakt}/seasons/${Number(se[1])}/episodes/${Number(se[2])}`)
          const ep: any = er.ok ? await er.json() : null
          if (ep?.ids?.trakt) { episodes.push({ ids: { trakt: ep.ids.trakt } }); continue }
        }
        missing.push(title)
      } else if (it.ref_type === 'series' || it.ref_type === 'show') {
        const ids = await searchTraktIds(userId, 'show', title, it.year)
        if (ids?.trakt) shows.push({ ids: { trakt: ids.trakt } }); else missing.push(title)
      } else {
        const ids = await searchTraktIds(userId, 'movie', title, it.year)
        if (ids?.trakt) movies.push({ ids: { trakt: ids.trakt } }); else missing.push(title)
      }
    } catch { apiErrors++; missing.push(title) }
  }

  const resolvedCount = movies.length + shows.length + episodes.length
  if (resolvedCount === 0) {
    // Si tout a échoué sur des erreurs API (token expiré, app injoignable…), ce n'est
    // pas « titres introuvables » : on le signale comme un problème côté Trakt.
    if (apiErrors > 0 && apiErrors === missing.length) {
      return res.status(502).json({ error: 'Trakt injoignable (token expiré ou API en erreur). Vérifie la liaison du profil.', missing })
    }
    return res.status(422).json({ error: 'Aucun titre n\'a pu être résolu sur Trakt.', missing })
  }

  // ── Création de la liste puis ajout des items ──────────────────────────────
  try {
    const createRes = await traktFetch(userId, '/users/me/lists', {
      method: 'POST',
      body: JSON.stringify({ name: pl.name, description: pl.description ?? undefined, privacy: parsed.data.privacy ?? 'private' }),
    })
    if (!createRes.ok) {
      const txt = await createRes.text().catch(() => '')
      return res.status(502).json({ error: `Création de la liste Trakt refusée (${createRes.status}).`, detail: txt.slice(0, 200) })
    }
    const list: any = await createRes.json()
    const listSlug = list.ids?.slug
    const addRes = await traktFetch(userId, `/users/me/lists/${list.ids?.trakt}/items`, {
      method: 'POST',
      body: JSON.stringify({ movies, shows, episodes }),
    })
    const added: any = addRes.ok ? await addRes.json() : null
    const url = acc.username && listSlug ? `https://trakt.tv/users/${acc.username}/lists/${listSlug}` : `https://trakt.tv/lists/${list.ids?.trakt}`
    console.log(`[trakt] liste « ${pl.name} » poussée → profil ${userId} (${resolvedCount} items, ${missing.length} manquants)`)
    res.json({
      ok: true,
      url,
      list_name: pl.name,
      resolved: resolvedCount,
      added: added?.added ?? { movies: movies.length, shows: shows.length, episodes: episodes.length },
      missing,
    })
  } catch (e: any) {
    res.status(502).json({ error: `Trakt indisponible : ${e.message}` })
  }
})

// Délier un compte.
router.delete('/auth/unlink/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10)
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'bad_user_id' })
  await db.execute({ sql: 'DELETE FROM trakt_accounts WHERE user_id = ?', args: [userId] })
  res.json({ ok: true })
})

export default router
