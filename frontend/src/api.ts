const BASE = '/api'

// ── État d'auth (profil courant + token admin) ───────────────────────────────
let currentUserId: number | null = (() => {
  const v = localStorage.getItem('hub.userId')
  return v ? Number(v) : null
})()
let adminToken: string | null = sessionStorage.getItem('hub.adminToken')

export function setCurrentUserId(id: number | null) {
  currentUserId = id
  if (id == null) localStorage.removeItem('hub.userId')
  else localStorage.setItem('hub.userId', String(id))
}
export function getCurrentUserId() { return currentUserId }

export function setAdminToken(token: string | null) {
  adminToken = token
  if (!token) sessionStorage.removeItem('hub.adminToken')
  else sessionStorage.setItem('hub.adminToken', token)
}
export function getAdminToken() { return adminToken }
export function isAdminUnlocked() { return !!adminToken }

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  if (currentUserId != null) h['X-User-Id'] = String(currentUserId)
  if (adminToken) h['X-Admin-Token'] = adminToken
  return h
}

export interface User {
  id: number
  name: string
  avatar_color: string
  is_admin: boolean
  has_pin: boolean
  has_nfc: boolean
  preferred_lang: string
  default_device_id: string | null  // device présélectionné à l'activation du profil
  default_player: string | null     // lecteur IPTV du profil (prime sur celui du device)
  created_at: number
}

export interface ScrapedListItem {
  position: number
  title: string
  original_title?: string | null
  year?: number | null
  type: 'movie' | 'series'
}
export interface ScrapedList {
  title: string
  cover?: string | null
  description?: string | null
  likes: number
  total: number
  source_url: string
  items: ScrapedListItem[]
}
export interface ScListResult {
  id: number
  title: string
  url: string
  cover?: string | null
  likes: number
}

// app : 'iptv' | 'plex' | 'launchbox' | 'catalog'
export interface FavoriteInput {
  app: string
  ref_id: string
  ref_type?: string
  title?: string
  thumb?: string
}
export interface Favorite extends FavoriteInput {
  id: number
  created_at: number
}

export interface PlaylistItem {
  id: number
  playlist_id: number
  position: number
  app: string
  ref_id?: string
  ref_type?: string
  title?: string
  year?: number
  thumb?: string
  lang?: string
  ext?: string
  status: 'resolved' | 'missing'
  created_at: number
}
export interface Playlist {
  id: number
  owner_user_id: number
  owner_name?: string
  name: string
  description?: string
  cover?: string
  is_shared: number
  source: string
  source_url?: string
  item_count?: number
  created_at: number
  updated_at: number
  items?: PlaylistItem[]
}
export interface PlaylistItemInput {
  app: string
  ref_id?: string
  ref_type?: string
  title?: string
  year?: number
  thumb?: string
  lang?: string
  ext?: string
  status?: 'resolved' | 'missing'
}

export interface Device {
  id: string
  name: string
  platform: string
  ip?: string
  last_seen: number
  capabilities: Capability[]
  ws_connected: boolean
}

export interface Capability {
  app: string
  package?: string
  can_receive: string[]
  launch_method: string
}

export interface CatalogEntry {
  id: string
  title: string
  type: string
  ean?: string
  year?: number
  plex_id?: string
  tivimate_id?: string
  thumbnail?: string
}

export interface PlaybackState {
  device_id: string
  device_name: string
  catalog_id?: string
  title?: string
  app?: string
  status: string
  started_at?: number
  ws_connected: boolean
}

export interface HistoryEntry {
  id: number
  device_id: string
  device_name: string
  catalog_id?: string
  title?: string
  app?: string
  started_at: number
  ended_at?: number
  requester: string
  user_id?: number
  user_name?: string
  user_color?: string
}

export interface DeviceConfig {
  xtream_server: string
  xtream_user: string
  xtream_pass: string
  xtream_ext: string
  plex_server_id: string
  app_mappings: Record<string, string>
  xtream_credential_id: number | null
  tvoverlay_enabled: boolean
  overlay_player_duration: number  // secondes, 0 = persistant
  iptv_player?: 'auto' | 'justplayer' | 'mxplayer' | 'vlc' | 'tivimate'
}

export interface Credential {
  id: number
  name: string
  type: 'xtream' | 'spotify_app'
  data: Record<string, any>
  created_at: number
  updated_at: number
}

// ── Spotify ──────────────────────────────────────────────────────────────────
export interface SpotifyAccount {
  user_id: number
  spotify_user_id: string | null
  display_name: string | null
  product: string | null  // 'premium' | 'free' | ...
  image: string | null
}
export interface SpotifyStatus {
  app_configured: boolean
  redirect_uri: string | null
  maison_user_id: number
  accounts: SpotifyAccount[]
}
export interface SpotifyControlInput {
  user_id?: number
  action: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'transfer' | 'volume' | 'shuffle' | 'repeat'
  device_id?: string
  context_uri?: string
  uris?: string[]
  offset?: { position?: number; uri?: string }
  position_ms?: number
  volume_percent?: number
  state?: boolean | 'off' | 'track' | 'context'
}

export interface PlayIntent {
  query?: string
  catalog_id?: string
  ean?: string
  plex_id?: string
  iptv_stream_id?: string
  iptv_type?: 'live' | 'vod' | 'series'
  iptv_ext?: string
  external_url?: string
  external_platform?: string
  spotify_uri?: string
  spotify_device_id?: string
  title?: string
  thumb?: string
  resume?: boolean
  device_id?: string
  app?: string
  requester: string
}

export interface DiscoverItem {
  guid: string
  key?: string
  ratingKey?: string
  title: string
  year?: number
  type: 'movie' | 'show' | string
  thumb?: string
  art?: string
  summary?: string
  duration?: number
  score?: number
}

export interface DiscoverAvailability {
  platform: string  // "netflix" | "disney+" | "primevideo" | "iptv" | ...
  title: string     // libellé affiché ("Netflix", "IPTV (VOD)", "IPTV (Série)")
  url: string
  offerType?: 'subscription' | 'buy' | 'rent' | 'free' | string
  price?: number | null
  quality?: string
  // Présent uniquement pour platform="iptv"
  iptv_credential_id?: number
  iptv_stream_id?: string          // stream_id pour vod, series_id pour series
  iptv_kind?: 'vod' | 'series'
  iptv_language?: string           // "FR", "EN", ... — undefined si non détectée
}

// Résultat d'un scan réseau ADB (découverte de lecteurs)
export interface DiscoveredDevice {
  ip: string
  adb_port: number
  agent: { id: string; name: string; last_seen: number } | null
}
export interface DiscoverResult {
  subnet: string
  scanned: number
  devices: DiscoveredDevice[]
}

// État de lecture temps réel d'un device (barre « lecture en cours »)
export interface MediaNow {
  state: 'playing' | 'paused' | 'stopped'
  app?: string
  title?: string
  position: number   // ms (instantané au moment de updated_at)
  duration: number   // ms (0 = inconnu / live)
  seekable: boolean
  package?: string
  updated_at: number // ms epoch — pour extrapoler la position pendant la lecture
}

export interface IptvCategory { id: string; name: string; state?: 'hidden' | 'locked' }
// Préférence de catégorie posée par l'admin : scope 'global' ou un user_id (texte).
// 'visible' (scope profil) = ré-affiche un groupe masqué/verrouillé globalement.
export interface IptvCategoryPref { category_id: string; scope: string; state: 'hidden' | 'locked' | 'visible' }
export interface IptvStream {
  stream_id: string
  name: string
  logo?: string
  category_id: string
  added?: string
  rating?: string
  year?: string
  language?: string
  type: 'live' | 'vod' | 'series'
}

export interface EpgEntry {
  id: string
  start_ts: number
  stop_ts: number
  title: string
  desc: string
}

export interface EpgReminder {
  id: number
  stream_id: string
  channel_name?: string
  title?: string
  start_ts: number
  device_id?: string
  lead_min: number
  notified: number
}

export interface IptvEpisode {
  episode_id: string
  episode_num: number
  title: string
  plot?: string
  duration?: string
  rating?: string
  air_date?: string
  container_extension: string
  movie_image?: string
}

export interface IptvSeason {
  season_number: number
  name: string
  cover?: string
  overview?: string
  episode_count: number
  episodes: IptvEpisode[]
}

export interface IptvSeriesInfo {
  info: {
    name: string
    cover?: string
    plot?: string
    cast?: string
    director?: string
    genre?: string
    release_date?: string
    rating?: string
  }
  seasons: IptvSeason[]
}

export interface PlexSection {
  id: string
  title: string
  type: string
  agent?: string
}

export interface PlexItem {
  ratingKey: string
  title: string
  year?: number
  type: string
  thumb?: string
  art?: string
  summary?: string
  duration?: number
  rating?: number
  contentRating?: string
  addedAt?: number
  viewCount?: number
  viewOffset?: number  // ms — si > 0, l'item est en cours de lecture
}

export interface PlexOnDeckItem extends PlexItem {
  viewedAt?: number
  grandparentTitle?: string
  parentIndex?: number
  index?: number
}

export interface PlexEpisode {
  ratingKey: string
  episode_number: number
  title: string
  summary?: string
  duration?: number
  viewOffset?: number
  viewCount?: number
  thumb?: string
  air_date?: string
  rating?: number
}

export interface PlexSeasonDetail {
  ratingKey: string
  season_number: number
  title: string
  thumb?: string
  episode_count: number
  viewed_count: number
  episodes: PlexEpisode[]
}

export interface PlexShowDetail {
  info: {
    ratingKey: string
    title: string
    year?: number
    thumb?: string
    art?: string
    summary?: string
    rating?: number
    contentRating?: string
    leafCount: number
    viewedLeafCount: number
  }
  seasons: PlexSeasonDetail[]
}

async function extractError(r: Response): Promise<Error> {
  const text = await r.text()
  try {
    const j = JSON.parse(text)
    // Token admin invalide/expiré (ex. backend redéployé : les tokens sont en
    // mémoire serveur). On purge le token local et on re-verrouille la section
    // Admin (UserContext écoute cet événement) → re-saisie du PIN.
    if (r.status === 403 && j.error === 'admin_required') {
      setAdminToken(null)
      window.dispatchEvent(new Event('hub:admin-expired'))
      return new Error('Session admin expirée — re-saisis le PIN')
    }
    return new Error(typeof j.error === 'string' ? j.error : text)
  } catch {
    return new Error(text || `HTTP ${r.status}`)
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: authHeaders() })
  if (!r.ok) throw await extractError(r)
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(body)
  })
  if (!r.ok) throw await extractError(r)
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: authHeaders(true),
    body: JSON.stringify(body)
  })
  if (!r.ok) throw await extractError(r)
  return r.json()
}

async function del<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: authHeaders() })
  if (!r.ok) throw await extractError(r)
  return r.json()
}

export const api = {
  devices: {
    list: () => get<Device[]>('/devices'),
    remove: (id: string) => del<{ ok: boolean }>(`/devices/${id}`),
    getConfig: (id: string) => get<DeviceConfig>(`/devices/${id}/config`),
    saveConfig: (id: string, cfg: DeviceConfig) => put<{ ok: boolean }>(`/devices/${id}/config`, cfg)
  },
  state: {
    all: () => get<PlaybackState[]>('/state'),
    history: (userFilter?: string) => get<HistoryEntry[]>(`/state/history${userFilter ? `?user_id=${userFilter}` : ''}`),
    deleteHistory: (id: number) => del<{ ok: boolean }>(`/state/history/${id}`),
    clearHistory: (userFilter?: string) => del<{ ok: boolean }>(`/state/history${userFilter ? `?user_id=${userFilter}` : ''}`),
    played: () => get<string[]>('/state/played'),
  },
  users: {
    list: () => get<User[]>('/users'),
    create: (u: { name: string; avatar_color?: string; is_admin?: boolean; pin?: string; nfc_token?: string; preferred_lang?: string }) => post<{ ok: boolean; id: number }>('/users', u),
    update: (id: number, u: { name?: string; avatar_color?: string; is_admin?: boolean; pin?: string; nfc_token?: string | null; preferred_lang?: string; default_device_id?: string | null; default_player?: string | null }) => put<{ ok: boolean }>(`/users/${id}`, u),
    remove: (id: number) => del<{ ok: boolean }>(`/users/${id}`),
    verifyPin: (pin: string) => post<{ ok: boolean; token: string; admin: { id: number; name: string } }>('/users/verify-pin', { pin }),
    // Vérifie le PIN sans obtenir de droits admin (déverrouillage parental)
    checkPin: (pin: string) => post<{ ok: boolean }>('/users/check-pin', { pin }),
    // Valide le token admin courant (403 admin_required si mort → re-PIN)
    adminPing: () => get<{ ok: boolean }>('/users/admin/ping'),
  },
  favorites: {
    list: () => get<Favorite[]>('/favorites'),
    add: (f: FavoriteInput) => post<{ ok: boolean }>('/favorites', f),
    remove: (app: string, ref_id: string) => del<{ ok: boolean }>(`/favorites?app=${encodeURIComponent(app)}&ref_id=${encodeURIComponent(ref_id)}`),
  },
  playlists: {
    list: () => get<Playlist[]>('/playlists'),
    get: (id: number) => get<Playlist>(`/playlists/${id}`),
    create: (p: { name: string; description?: string; cover?: string; is_shared?: boolean; source?: string; source_url?: string }) => post<{ ok: boolean; id: number }>('/playlists', p),
    update: (id: number, p: { name?: string; description?: string | null; cover?: string | null; is_shared?: boolean }) => put<{ ok: boolean }>(`/playlists/${id}`, p),
    remove: (id: number) => del<{ ok: boolean }>(`/playlists/${id}`),
    addItem: (id: number, item: PlaylistItemInput) => post<{ ok: boolean; id: number }>(`/playlists/${id}/items`, item),
    removeItem: (id: number, itemId: number) => del<{ ok: boolean }>(`/playlists/${id}/items/${itemId}`),
    reorder: (id: number, order: number[]) => put<{ ok: boolean }>(`/playlists/${id}/reorder`, { order }),
  },
  senscritique: {
    scrape: (url: string) => post<ScrapedList>('/senscritique/scrape', { url }),
    search: (q: string) => get<ScListResult[]>(`/senscritique/search?q=${encodeURIComponent(q)}`),
  },
  play: (intent: PlayIntent) => post<{ ok: boolean; title: string; device_id: string; app: string }>('/play', intent),
  credentials: {
    list: () => get<Credential[]>('/credentials'),
    create: (c: Omit<Credential, 'id' | 'created_at' | 'updated_at'>) => post<{ ok: boolean; id: number }>('/credentials', c),
    update: (id: number, c: Omit<Credential, 'id' | 'created_at' | 'updated_at'>) => put<{ ok: boolean }>(`/credentials/${id}`, c),
    remove: (id: number) => del<{ ok: boolean }>(`/credentials/${id}`)
  },
  spotify: {
    status: () => get<SpotifyStatus>('/spotify/status'),
    // Renvoie l'URL d'autorisation à ouvrir en popup pour lier le compte du profil.
    loginUrl: (userId: number) => get<{ url: string }>(`/spotify/login?user_id=${userId}`),
    unlink: (userId: number) => del<{ ok: boolean }>(`/spotify/unlink/${userId}`),
    me: (userId?: number) => get<any>(`/spotify/me${userId !== undefined ? `?user_id=${userId}` : ''}`),
    playlists: (userId?: number, opts: { limit?: number; offset?: number } = {}) => {
      const p = new URLSearchParams()
      if (userId !== undefined) p.set('user_id', String(userId))
      if (opts.limit) p.set('limit', String(opts.limit))
      if (opts.offset) p.set('offset', String(opts.offset))
      return get<any>(`/spotify/playlists?${p}`)
    },
    playlistTracks: (id: string, userId?: number, opts: { limit?: number; offset?: number } = {}) => {
      const p = new URLSearchParams()
      if (userId !== undefined) p.set('user_id', String(userId))
      if (opts.limit) p.set('limit', String(opts.limit))
      if (opts.offset) p.set('offset', String(opts.offset))
      return get<any>(`/spotify/playlists/${encodeURIComponent(id)}/tracks?${p}`)
    },
    search: (q: string, userId?: number, type = 'track,album,artist,playlist') => {
      const p = new URLSearchParams({ q, type })
      if (userId !== undefined) p.set('user_id', String(userId))
      return get<any>(`/spotify/search?${p}`)
    },
    recentlyPlayed: (userId?: number) => get<any>(`/spotify/recently-played${userId !== undefined ? `?user_id=${userId}` : ''}`),
    devices: (userId?: number) => get<{ devices: any[] }>(`/spotify/devices${userId !== undefined ? `?user_id=${userId}` : ''}`),
    player: (userId?: number) => get<any>(`/spotify/player${userId !== undefined ? `?user_id=${userId}` : ''}`),
    control: (input: SpotifyControlInput) => post<{ ok: boolean }>('/spotify/control', input),
  },
  discover: {
    scan: (subnet?: string) => get<DiscoverResult>(`/discover${subnet ? `?subnet=${subnet}` : ''}`),
    apkStatus: () => get<{ present: boolean; size?: number }>(`/discover/agent-apk`),
    uploadApk: async (file: File) => {
      const r = await fetch(`${BASE}/discover/agent-apk`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      if (!r.ok) throw await extractError(r)
      return r.json() as Promise<{ ok: boolean; size: number }>
    },
    deploy: (ip: string) => post<{ status: 'ok' | 'authorize'; message: string }>(`/discover/${ip}/deploy`, {}),
    installPlayers: (ip: string) => post<{ status: 'ok' | 'authorize'; message: string }>(`/discover/${ip}/install-players`, {}),
    players: () => get<{ id: string; label: string; size: number }[]>(`/discover/players`),
    uploadPlayer: async (file: File, label: string) => {
      const r = await fetch(`${BASE}/discover/players?label=${encodeURIComponent(label)}`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' }, body: file,
      })
      if (!r.ok) throw await extractError(r)
      return r.json() as Promise<{ ok: boolean; id: string; size: number }>
    },
    removePlayer: (id: string) => del<{ ok: boolean }>(`/discover/players/${id}`),
    fetchJustPlayer: () => post<{ ok: boolean; version: string; size: number }>(`/discover/players/fetch-justplayer`, {}),
  },
  control: {
    send: (deviceId: string, action: 'play_pause' | 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'mute') =>
      post<{ ok: boolean; action: string }>(`/control/${deviceId}/${action}`, {}),
    seek: (deviceId: string, positionMs: number) =>
      post<{ ok: boolean; action: string }>(`/control/${deviceId}/seek?position=${Math.max(0, Math.round(positionMs))}`, {}),
    now: (deviceId: string) => get<MediaNow | null>(`/state/now/${deviceId}`),
  },
  iptv: {
    credentials: () => get<{ id: number; name: string }[]>('/iptv/credentials'),
    categories: (credId: number, type: 'live' | 'vod' | 'series', all = false) => get<IptvCategory[]>(`/iptv/${credId}/categories?type=${type}${all ? '&all=1' : ''}`),
    categoryPrefs: (credId: number, type: 'live' | 'vod' | 'series') => get<IptvCategoryPref[]>(`/iptv/${credId}/category-prefs?type=${type}`),
    setCategoryPref: (credId: number, pref: { type: 'live' | 'vod' | 'series'; category_id: string; scope: string; state: 'hidden' | 'locked' | 'visible' | null }) =>
      put<{ ok: boolean }>(`/iptv/${credId}/category-prefs`, pref),
    setCategoryPrefsBulk: (credId: number, bulk: { type: 'live' | 'vod' | 'series'; scope: string; state: 'hidden' | 'locked' | 'visible' | null; category_ids: string[] }) =>
      put<{ ok: boolean; count: number }>(`/iptv/${credId}/category-prefs/bulk`, bulk),
    languages: (credId: number, type: 'live' | 'vod' | 'series') => get<{ code: string; count: number }[]>(`/iptv/${credId}/languages?type=${type}`),
    streams: (credId: number, opts: { type: 'live' | 'vod' | 'series'; category?: string; search?: string; languages?: string[]; start?: number; limit?: number; sort?: string }) => {
      const p = new URLSearchParams({ type: opts.type })
      if (opts.category) p.set('category', opts.category)
      if (opts.search) p.set('search', opts.search)
      if (opts.languages && opts.languages.length) p.set('languages', opts.languages.join(','))
      if (opts.start !== undefined) p.set('start', String(opts.start))
      if (opts.limit) p.set('limit', String(opts.limit))
      if (opts.sort) p.set('sort', opts.sort)
      return get<{ total: number; start: number; size: number; items: IptvStream[] }>(`/iptv/${credId}/streams?${p}`)
    },
    seriesInfo: (credId: number, seriesId: string) => get<IptvSeriesInfo>(`/iptv/${credId}/series/${seriesId}`),
    epgBatch: (credId: number, streamIds: string[]) => post<Record<string, EpgEntry[]>>(`/iptv/${credId}/epg/batch`, { stream_ids: streamIds }),
    reminders: {
      list: () => get<EpgReminder[]>('/iptv/reminders'),
      create: (r: { cred_id?: number; stream_id: string; channel_name?: string; title?: string; start_ts: number; device_id?: string; lead_min?: number; logo?: string }) => post<{ ok: boolean; id: number }>('/iptv/reminders', r),
      remove: (id: number) => del<{ ok: boolean }>(`/iptv/reminders/${id}`),
    },
    imageUrl: (url?: string) => url ? `${BASE}/iptv/image?url=${encodeURIComponent(url)}` : '',
  },
  plex: {
    status: () => get<{ connected: boolean; server_url: string | null; server_machine_id: string | null }>('/plex/status'),
    startPin: () => post<{ id: number; pin: string; auth_url: string }>('/plex/pin', {}),
    pollPin: (id: number) => get<{ done: boolean; server_url?: string }>(`/plex/pin/${id}`),
    disconnect: () => del<{ ok: boolean }>('/plex/token'),
    sections: () => get<PlexSection[]>('/plex/sections'),
    onDeck: (limit = 20) => get<PlexOnDeckItem[]>(`/plex/onDeck?limit=${limit}`),
    show: (ratingKey: string) => get<PlexShowDetail>(`/plex/show/${ratingKey}`),
    discoverSearch: (q: string) => get<DiscoverItem[]>(`/plex/discover/search?q=${encodeURIComponent(q)}`),
    discoverAvailabilities: (ratingKey: string, title?: string, year?: number) => {
      const p = new URLSearchParams()
      if (title) p.set('title', title)
      if (year) p.set('year', String(year))
      const qs = p.toString()
      return get<DiscoverAvailability[]>(`/plex/discover/${ratingKey}/availabilities${qs ? '?' + qs : ''}`)
    },
    discoverImageUrl: (url?: string) => url ? `${BASE}/plex/discover/image?url=${encodeURIComponent(url)}` : '',
    sectionItems: (id: string, opts: { start?: number; size?: number; sort?: string; search?: string } = {}) => {
      const p = new URLSearchParams()
      if (opts.start !== undefined) p.set('start', String(opts.start))
      if (opts.size !== undefined) p.set('size', String(opts.size))
      if (opts.sort) p.set('sort', opts.sort)
      if (opts.search) p.set('search', opts.search)
      return get<{ total: number; start: number; size: number; items: PlexItem[] }>(`/plex/sections/${id}/all?${p}`)
    },
    imageUrl: (path?: string) => path ? `${BASE}/plex/image?path=${encodeURIComponent(path)}` : '',
  }
}
