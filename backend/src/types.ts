export type DevicePlatform = 'android_tv' | 'fire_tv' | 'shield' | 'apple_tv' | 'roku' | 'kodi' | 'other'
export type MediaType = 'movie' | 'episode' | 'music' | 'live_channel' | 'vod'
export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'error'
export type AppId = 'plex' | 'iptv' | 'tivimate' | 'kodi' | 'jellyfin' | 'emby' | 'external' | 'custom' | 'spotify'
export type RequesterType = 'zaparoo' | 'llm' | 'n8n' | 'manual' | 'ha'

export interface DeviceCapability {
  app: AppId
  package?: string
  can_receive: MediaType[]
  launch_method: string
}

export interface Device {
  id: string
  name: string
  platform: DevicePlatform
  ip?: string
  last_seen: number
  capabilities: DeviceCapability[]
  ws_connected: boolean
}

export interface CatalogEntry {
  id: string
  title: string
  type: MediaType
  ean?: string
  year?: number
  plex_id?: string
  tivimate_id?: string
  thumbnail?: string
  metadata: Record<string, unknown>
}

export interface PlayIntent {
  query?: string
  catalog_id?: string
  ean?: string
  device_id?: string
  app?: AppId
  requester: RequesterType
}

export interface PlaybackState {
  device_id: string
  catalog_id?: string
  app?: AppId
  status: PlaybackStatus
  started_at?: number
  title?: string
}

// Messages WebSocket Hub <-> Agent
export type WsMessageType =
  | 'register'
  | 'state_update'
  | 'ping'
  | 'pong'
  | 'play'
  | 'stop'
  | 'error'
  | 'launchbox_reset'
  | 'launchbox_reset_result'

export interface WsMessage {
  type: WsMessageType
  [key: string]: unknown
}

export interface WsPlayCommand extends WsMessage {
  type: 'play'
  catalog_id: string
  app: AppId
  title: string
  plex_id?: string
  plex_watch_url?: string
  tivimate_channel?: string
  iptv_type?: 'live' | 'vod' | 'series'
  stream_url?: string
  iptv_container?: string     // conteneur réel (mkv/mp4/ts...) pour poser le bon MIME côté player
  external_url?: string       // deep link Netflix/Disney+/etc.
  external_platform?: string  // "netflix" | "disney+" | "primevideo" | "appletvplus" | "web"
  player?: string             // lecteur IPTV préféré : 'auto' | 'mxplayer' | 'vlc' | 'tivimate'
  requester: RequesterType
}
