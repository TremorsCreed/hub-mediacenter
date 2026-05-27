const BASE = '/api'

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
}

export interface DeviceConfig {
  xtream_server: string
  xtream_user: string
  xtream_pass: string
  xtream_ext: string
  plex_server_id: string
  app_mappings: Record<string, string>
  xtream_credential_id: number | null
}

export interface Credential {
  id: number
  name: string
  type: 'xtream'
  data: Record<string, any>
  created_at: number
  updated_at: number
}

export interface PlayIntent {
  query?: string
  catalog_id?: string
  ean?: string
  plex_id?: string
  iptv_stream_id?: string
  iptv_type?: 'live' | 'vod'
  title?: string
  device_id?: string
  app?: string
  requester: string
}

export interface IptvCategory { id: string; name: string }
export interface IptvStream {
  stream_id: string
  name: string
  logo?: string
  category_id: string
  added?: string
  rating?: string
  year?: string
  type: 'live' | 'vod'
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
}

async function extractError(r: Response): Promise<Error> {
  const text = await r.text()
  try {
    const j = JSON.parse(text)
    return new Error(typeof j.error === 'string' ? j.error : text)
  } catch {
    return new Error(text || `HTTP ${r.status}`)
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw await extractError(r)
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw await extractError(r)
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw await extractError(r)
  return r.json()
}

async function del<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE' })
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
  catalog: {
    search: (q: string) => get<CatalogEntry[]>(`/catalog/search?q=${encodeURIComponent(q)}`),
    create: (entry: Omit<CatalogEntry, 'id'>) => post<{ ok: boolean; id: string }>('/catalog', entry),
    remove: (id: string) => del<{ ok: boolean }>(`/catalog/${id}`),
    mapEan: (ean: string, catalog_id: string) => post('/catalog/ean', { ean, catalog_id })
  },
  state: {
    all: () => get<PlaybackState[]>('/state'),
    history: () => get<HistoryEntry[]>('/state/history')
  },
  play: (intent: PlayIntent) => post<{ ok: boolean; title: string; device_id: string; app: string }>('/play', intent),
  credentials: {
    list: () => get<Credential[]>('/credentials'),
    create: (c: Omit<Credential, 'id' | 'created_at' | 'updated_at'>) => post<{ ok: boolean; id: number }>('/credentials', c),
    update: (id: number, c: Omit<Credential, 'id' | 'created_at' | 'updated_at'>) => put<{ ok: boolean }>(`/credentials/${id}`, c),
    remove: (id: number) => del<{ ok: boolean }>(`/credentials/${id}`)
  },
  control: {
    send: (deviceId: string, action: 'play_pause' | 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'mute') =>
      post<{ ok: boolean; action: string }>(`/control/${deviceId}/${action}`, {}),
  },
  iptv: {
    credentials: () => get<{ id: number; name: string }[]>('/iptv/credentials'),
    categories: (credId: number, type: 'live' | 'vod') => get<IptvCategory[]>(`/iptv/${credId}/categories?type=${type}`),
    streams: (credId: number, opts: { type: 'live' | 'vod'; category?: string; search?: string; limit?: number }) => {
      const p = new URLSearchParams({ type: opts.type })
      if (opts.category) p.set('category', opts.category)
      if (opts.search) p.set('search', opts.search)
      if (opts.limit) p.set('limit', String(opts.limit))
      return get<{ total: number; items: IptvStream[] }>(`/iptv/${credId}/streams?${p}`)
    },
    imageUrl: (url?: string) => url ? `${BASE}/iptv/image?url=${encodeURIComponent(url)}` : '',
  },
  plex: {
    status: () => get<{ connected: boolean; server_url: string | null; server_machine_id: string | null }>('/plex/status'),
    startPin: () => post<{ id: number; pin: string; auth_url: string }>('/plex/pin', {}),
    pollPin: (id: number) => get<{ done: boolean; server_url?: string }>(`/plex/pin/${id}`),
    disconnect: () => del<{ ok: boolean }>('/plex/token'),
    sections: () => get<PlexSection[]>('/plex/sections'),
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
