import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { db } from '../db'

// Compte « Maison » : enceintes partagées (Echo). Découplé du compte perso de
// l'admin pour ne plus polluer ses recommandations. cf. design Spotify.
export const MAISON_USER_ID = -1

const AUTH_BASE = 'https://accounts.spotify.com'
const API_BASE = 'https://api.spotify.com/v1'

// Scopes : lecture biblio/playlists + contrôle Spotify Connect (Premium requis).
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'streaming',
  'user-top-read',
].join(' ')

// ── Config de l'app Spotify (client_id/secret/redirect_uri) ──────────────────
// Source : credential type='spotify_app' (gérée dans Admin → Credentials), avec
// fallback sur les variables d'environnement pour le déploiement headless.
interface SpotifyAppConfig { client_id: string; client_secret: string; redirect_uri?: string }

async function getAppConfig(): Promise<SpotifyAppConfig | null> {
  const { rows } = await db.execute("SELECT data FROM credentials WHERE type = 'spotify_app' ORDER BY id LIMIT 1")
  if (rows.length) {
    const data = JSON.parse((rows[0] as any).data as string)
    if (data.client_id && data.client_secret) {
      return { client_id: data.client_id, client_secret: data.client_secret, redirect_uri: data.redirect_uri || undefined }
    }
  }
  const envId = process.env.SPOTIFY_CLIENT_ID
  const envSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (envId && envSecret) {
    return { client_id: envId, client_secret: envSecret, redirect_uri: process.env.SPOTIFY_REDIRECT_URI }
  }
  return null
}

// L'URI de redirection DOIT être identique à l'authorize et au token exchange, et
// déclarée à l'identique dans le dashboard Spotify. Spotify n'accepte http que pour
// le loopback (127.0.0.1) ; en LAN/prod il faut du https (cf. note de déploiement).
function resolveRedirectUri(cfg: SpotifyAppConfig, req: any): string {
  if (cfg.redirect_uri) return cfg.redirect_uri
  let host = (process.env.PUBLIC_URL || req.headers.host || '127.0.0.1') as string
  if (!host.includes(':') && !host.includes('.')) host = `${host}:${process.env.PORT || '8020'}`
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
  return `${proto}://${host}/api/spotify/callback`
}

const basicAuth = (cfg: SpotifyAppConfig) =>
  'Basic ' + Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64')

// ── OAuth state (nonce → user_id), TTL court, en mémoire ─────────────────────
interface PendingAuth { user_id: number; redirect_uri: string; expires: number }
const pendingAuth = new Map<string, PendingAuth>()
function gcPendingAuth() {
  const now = Date.now()
  for (const [k, v] of pendingAuth) if (v.expires < now) pendingAuth.delete(k)
}

// ── Stockage / rafraîchissement des tokens ───────────────────────────────────
interface SpotifyAccountRow {
  user_id: number
  spotify_user_id: string | null
  display_name: string | null
  email: string | null
  product: string | null
  access_token: string
  refresh_token: string
  expires_at: number
  scopes: string
  image: string | null
}

async function getAccountRow(userId: number): Promise<SpotifyAccountRow | null> {
  const { rows } = await db.execute({ sql: 'SELECT * FROM spotify_accounts WHERE user_id = ?', args: [userId] })
  return (rows[0] as any) ?? null
}

// Retourne un access_token valide, en rafraîchissant si besoin (< 60s de marge).
async function getAccessToken(userId: number): Promise<string | null> {
  const row = await getAccountRow(userId)
  if (!row) return null
  if (Date.now() < row.expires_at - 60_000) return row.access_token

  const cfg = await getAppConfig()
  if (!cfg) return null
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token })
  const r = await fetch(`${AUTH_BASE}/api/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(cfg), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!r.ok) {
    console.error('[spotify] refresh failed:', r.status, await r.text())
    return null
  }
  const data: any = await r.json()
  const accessToken = data.access_token as string
  const expiresAt = Date.now() + (Number(data.expires_in ?? 3600) * 1000)
  // Spotify ne renvoie pas toujours un nouveau refresh_token — garder l'ancien.
  const refreshToken = (data.refresh_token as string) || row.refresh_token
  await db.execute({
    sql: 'UPDATE spotify_accounts SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE user_id = ?',
    args: [accessToken, refreshToken, expiresAt, Date.now(), userId],
  })
  return accessToken
}

// Appel authentifié à la Web API pour le compte d'un profil. Réessaie une fois
// après un refresh forcé si 401.
async function spotifyFetch(userId: number, path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await getAccessToken(userId)
  if (!token) throw new Error('no_spotify_account')
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  })
  if (r.status === 401 && !retried) {
    // Force expiration puis retry
    await db.execute({ sql: 'UPDATE spotify_accounts SET expires_at = 0 WHERE user_id = ?', args: [userId] })
    return spotifyFetch(userId, path, init, true)
  }
  return r
}

const router = Router()

// Résout le profil cible : ?user_id explicite, sinon le profil courant (header).
function targetUser(req: any): number | null {
  const q = req.query.user_id
  if (q !== undefined) {
    const n = parseInt(String(q), 10)
    return Number.isFinite(n) ? n : null
  }
  return (req as any).userId ?? null
}

// ── Statut global : app configurée ? comptes liés ? ──────────────────────────
router.get('/status', async (req, res) => {
  const cfg = await getAppConfig()
  const { rows } = await db.execute(
    'SELECT user_id, spotify_user_id, display_name, product, image, expires_at FROM spotify_accounts'
  )
  res.json({
    app_configured: !!cfg,
    redirect_uri: cfg ? resolveRedirectUri(cfg, req) : null,
    maison_user_id: MAISON_USER_ID,
    accounts: rows.map((r: any) => ({
      user_id: r.user_id,
      spotify_user_id: r.spotify_user_id,
      display_name: r.display_name,
      product: r.product,
      image: r.image,
    })),
  })
})

// ── Démarrage OAuth : renvoie l'URL d'autorisation (ouverte en popup côté UI) ─
router.get('/login', async (req, res) => {
  const cfg = await getAppConfig()
  if (!cfg) return res.status(400).json({ error: 'spotify_app_not_configured' })
  const rawUser = req.query.user_id !== undefined ? parseInt(String(req.query.user_id), 10) : (req as any).userId
  if (rawUser === null || rawUser === undefined || !Number.isFinite(rawUser)) {
    return res.status(400).json({ error: 'user_id_required' })
  }
  gcPendingAuth()
  const state = randomBytes(16).toString('hex')
  const redirect_uri = resolveRedirectUri(cfg, req)
  pendingAuth.set(state, { user_id: rawUser, redirect_uri, expires: Date.now() + 10 * 60_000 })
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.client_id,
    scope: SCOPES,
    redirect_uri,
    state,
    show_dialog: 'true',
  })
  res.json({ url: `${AUTH_BASE}/authorize?${params}` })
})

// ── Callback OAuth : échange le code, récupère le profil, persiste les tokens ─
router.get('/callback', async (req, res) => {
  const code = req.query.code as string | undefined
  const state = req.query.state as string | undefined
  const err = req.query.error as string | undefined

  const closePage = (msg: string, ok: boolean) => `<!doctype html><html><head><meta charset="utf-8">
<title>Spotify</title><style>body{background:#18181b;color:#e4e4e7;font-family:system-ui;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}</style></head>
<body><div><h2>${ok ? '✓ Spotify lié' : '✗ Échec'}</h2><p>${msg}</p><p style="color:#71717a">Tu peux fermer cette fenêtre.</p></div>
<script>try{window.opener&&window.opener.postMessage({type:'spotify-linked',ok:${ok}},'*')}catch(e){}
setTimeout(function(){window.close()},${ok ? 1200 : 4000})</script></body></html>`

  if (err) return res.status(400).send(closePage(`Spotify a refusé : ${err}`, false))
  if (!code || !state) return res.status(400).send(closePage('Paramètres manquants.', false))
  gcPendingAuth()
  const pending = pendingAuth.get(state)
  if (!pending) return res.status(400).send(closePage('Session d\'autorisation expirée, recommence.', false))
  pendingAuth.delete(state)

  const cfg = await getAppConfig()
  if (!cfg) return res.status(400).send(closePage('App Spotify non configurée.', false))

  try {
    const tokenRes = await fetch(`${AUTH_BASE}/api/token`, {
      method: 'POST',
      headers: { Authorization: basicAuth(cfg), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: pending.redirect_uri }),
    })
    if (!tokenRes.ok) {
      console.error('[spotify] token exchange failed:', tokenRes.status, await tokenRes.text())
      return res.status(502).send(closePage('Échange de token refusé par Spotify.', false))
    }
    const tok: any = await tokenRes.json()
    const accessToken = tok.access_token as string
    const refreshToken = tok.refresh_token as string
    const expiresAt = Date.now() + (Number(tok.expires_in ?? 3600) * 1000)
    const grantedScopes = (tok.scope as string) || SCOPES

    // Récupérer le profil Spotify pour l'afficher dans le hub
    let spId = '', dispName = '', email = '', product = '', image = ''
    try {
      const meRes = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (meRes.ok) {
        const me: any = await meRes.json()
        spId = me.id ?? ''
        dispName = me.display_name ?? me.id ?? ''
        email = me.email ?? ''
        product = me.product ?? ''
        image = me.images?.[0]?.url ?? ''
      }
    } catch {}

    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO spotify_accounts
            (user_id, spotify_user_id, display_name, email, product, access_token, refresh_token, expires_at, scopes, image, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              spotify_user_id = excluded.spotify_user_id,
              display_name = excluded.display_name,
              email = excluded.email,
              product = excluded.product,
              access_token = excluded.access_token,
              refresh_token = excluded.refresh_token,
              expires_at = excluded.expires_at,
              scopes = excluded.scopes,
              image = excluded.image,
              updated_at = excluded.updated_at`,
      args: [pending.user_id, spId, dispName, email, product, accessToken, refreshToken, expiresAt, grantedScopes, image, now, now],
    })
    console.log(`[spotify] linked account ${dispName || spId} → profil ${pending.user_id} (${product})`)
    const warn = product && product !== 'premium' ? ' (compte non-Premium : le contrôle de lecture sera indisponible)' : ''
    return res.send(closePage(`Compte ${dispName || spId} lié.${warn}`, true))
  } catch (e: any) {
    console.error('[spotify] callback error:', e)
    return res.status(500).send(closePage('Erreur interne.', false))
  }
})

// ── Délier un compte ─────────────────────────────────────────────────────────
router.delete('/unlink/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10)
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'bad_user_id' })
  await db.execute({ sql: 'DELETE FROM spotify_accounts WHERE user_id = ?', args: [userId] })
  res.json({ ok: true })
})

// ── Profil Spotify courant ───────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  const userId = targetUser(req)
  if (userId === null) return res.status(400).json({ error: 'no_profile' })
  try {
    const r = await spotifyFetch(userId, '/me')
    if (!r.ok) return res.status(r.status).json({ error: 'spotify_error', detail: await r.text() })
    res.json(await r.json())
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ── Playlists du membre ──────────────────────────────────────────────────────
router.get('/playlists', async (req, res) => {
  const userId = targetUser(req)
  if (userId === null) return res.status(400).json({ error: 'no_profile' })
  const limit = Math.min(50, parseInt(String(req.query.limit ?? '50'), 10) || 50)
  const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0
  try {
    const r = await spotifyFetch(userId, `/me/playlists?limit=${limit}&offset=${offset}`)
    if (!r.ok) return res.status(r.status).json({ error: 'spotify_error', detail: await r.text() })
    res.json(await r.json())
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ── Items d'une playlist ─────────────────────────────────────────────────────
router.get('/playlists/:id/tracks', async (req, res) => {
  const userId = targetUser(req)
  if (userId === null) return res.status(400).json({ error: 'no_profile' })
  const limit = Math.min(100, parseInt(String(req.query.limit ?? '100'), 10) || 100)
  const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0
  try {
    const r = await spotifyFetch(userId, `/playlists/${encodeURIComponent(req.params.id)}/tracks?limit=${limit}&offset=${offset}`)
    if (!r.ok) return res.status(r.status).json({ error: 'spotify_error', detail: await r.text() })
    res.json(await r.json())
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ── Recherche (note : limit max 10 depuis fév. 2026) ─────────────────────────
router.get('/search', async (req, res) => {
  const userId = targetUser(req)
  if (userId === null) return res.status(400).json({ error: 'no_profile' })
  const q = String(req.query.q ?? '').trim()
  if (!q) return res.json({ tracks: { items: [] } })
  const type = String(req.query.type ?? 'track,album,artist,playlist')
  const limit = Math.min(10, parseInt(String(req.query.limit ?? '10'), 10) || 10)
  try {
    const r = await spotifyFetch(userId, `/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&limit=${limit}`)
    if (!r.ok) return res.status(r.status).json({ error: 'spotify_error', detail: await r.text() })
    res.json(await r.json())
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ── Écoutés récemment ────────────────────────────────────────────────────────
router.get('/recently-played', async (req, res) => {
  const userId = targetUser(req)
  if (userId === null) return res.status(400).json({ error: 'no_profile' })
  const limit = Math.min(50, parseInt(String(req.query.limit ?? '30'), 10) || 30)
  try {
    const r = await spotifyFetch(userId, `/me/player/recently-played?limit=${limit}`)
    if (!r.ok) return res.status(r.status).json({ error: 'spotify_error', detail: await r.text() })
    res.json(await r.json())
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ── Appareils Spotify Connect visibles par ce compte ─────────────────────────
router.get('/devices', async (req, res) => {
  const userId = targetUser(req)
  if (userId === null) return res.status(400).json({ error: 'no_profile' })
  try {
    const r = await spotifyFetch(userId, '/me/player/devices')
    if (!r.ok) return res.status(r.status).json({ error: 'spotify_error', detail: await r.text() })
    res.json(await r.json())
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ── État de lecture courant ──────────────────────────────────────────────────
router.get('/player', async (req, res) => {
  const userId = targetUser(req)
  if (userId === null) return res.status(400).json({ error: 'no_profile' })
  try {
    const r = await spotifyFetch(userId, '/me/player')
    if (r.status === 204) return res.json({ playing: false })
    if (!r.ok) return res.status(r.status).json({ error: 'spotify_error', detail: await r.text() })
    res.json(await r.json())
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ── Contrôle de lecture (Premium requis) ─────────────────────────────────────
const ControlSchema = z.object({
  user_id: z.number().optional(),
  action: z.enum(['play', 'pause', 'next', 'previous', 'seek', 'transfer', 'volume', 'shuffle', 'repeat']),
  device_id: z.string().optional(),
  // play
  context_uri: z.string().optional(),    // playlist/album/artist
  uris: z.array(z.string()).optional(),  // pistes
  offset: z.object({ position: z.number().optional(), uri: z.string().optional() }).optional(),
  position_ms: z.number().optional(),
  // volume / shuffle / repeat
  volume_percent: z.number().optional(),
  state: z.union([z.boolean(), z.enum(['off', 'track', 'context'])]).optional(),
})

router.post('/control', async (req, res) => {
  const parsed = ControlSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const d = parsed.data
  const userId = d.user_id ?? (req as any).userId ?? null
  if (userId === null) return res.status(400).json({ error: 'no_profile' })

  const dq = d.device_id ? `?device_id=${encodeURIComponent(d.device_id)}` : ''
  try {
    let r: Response
    switch (d.action) {
      case 'play': {
        const body: any = {}
        if (d.context_uri) body.context_uri = d.context_uri
        if (d.uris) body.uris = d.uris
        if (d.offset) body.offset = d.offset
        if (d.position_ms !== undefined) body.position_ms = d.position_ms
        r = await spotifyFetch(userId, `/me/player/play${dq}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        break
      }
      case 'pause':
        r = await spotifyFetch(userId, `/me/player/pause${dq}`, { method: 'PUT' }); break
      case 'next':
        r = await spotifyFetch(userId, `/me/player/next${dq}`, { method: 'POST' }); break
      case 'previous':
        r = await spotifyFetch(userId, `/me/player/previous${dq}`, { method: 'POST' }); break
      case 'seek':
        r = await spotifyFetch(userId, `/me/player/seek?position_ms=${d.position_ms ?? 0}${d.device_id ? `&device_id=${encodeURIComponent(d.device_id)}` : ''}`, { method: 'PUT' }); break
      case 'volume':
        r = await spotifyFetch(userId, `/me/player/volume?volume_percent=${Math.round(d.volume_percent ?? 50)}${d.device_id ? `&device_id=${encodeURIComponent(d.device_id)}` : ''}`, { method: 'PUT' }); break
      case 'shuffle':
        r = await spotifyFetch(userId, `/me/player/shuffle?state=${d.state === true ? 'true' : 'false'}${d.device_id ? `&device_id=${encodeURIComponent(d.device_id)}` : ''}`, { method: 'PUT' }); break
      case 'repeat':
        r = await spotifyFetch(userId, `/me/player/repeat?state=${typeof d.state === 'string' ? d.state : 'off'}${d.device_id ? `&device_id=${encodeURIComponent(d.device_id)}` : ''}`, { method: 'PUT' }); break
      case 'transfer':
        if (!d.device_id) return res.status(400).json({ error: 'device_id_required' })
        r = await spotifyFetch(userId, '/me/player', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_ids: [d.device_id], play: true }),
        })
        break
      default:
        return res.status(400).json({ error: 'unknown_action' })
    }
    if (!r.ok && r.status !== 204) {
      const detail = await r.text()
      // 404 NO_ACTIVE_DEVICE / 403 PREMIUM_REQUIRED sont les cas les plus courants
      return res.status(r.status).json({ error: 'spotify_control_failed', status: r.status, detail })
    }
    res.json({ ok: true })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

export default router
export { getAccessToken, spotifyFetch }
