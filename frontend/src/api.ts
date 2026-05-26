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
  app_mappings: Record<string, string>
}

export interface PlayIntent {
  query?: string
  catalog_id?: string
  ean?: string
  device_id?: string
  app?: string
  requester: string
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

async function del<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
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
  play: (intent: PlayIntent) => post<{ ok: boolean; title: string; device_id: string; app: string }>('/play', intent)
}
