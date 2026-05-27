// Messages WebSocket Hub <-> Agent (mêmes shapes que côté backend/Android)

export interface WsMessage {
  type: string
  [key: string]: unknown
}

export interface WsPlayCommand extends WsMessage {
  type: 'play'
  catalog_id: string
  app: string
  title: string
  plex_id?: string
  plex_watch_url?: string
  tivimate_channel?: string
  iptv_type?: 'live' | 'vod'
  stream_url?: string
  external_url?: string
  external_platform?: string
  requester: string
}

export interface DeviceCapability {
  app: string
  package?: string
  can_receive: string[]
  launch_method: string
}

export type LaunchResult =
  | { kind: 'success' }
  | { kind: 'app_not_installed'; what: string }
  | { kind: 'error'; reason: string }

export interface PlayContext {
  cmd: WsPlayCommand
  onState: (status: 'playing' | 'stopped' | 'error', extra?: { app?: string }) => void
}
