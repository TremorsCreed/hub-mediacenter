import type { Device } from './api'

// Miroir d'écran via ws-scrcpy (conteneur sur le homelab, port 8000), embarqué
// en iframe dans le Hub (PIP épinglable ou plein écran).
export function remoteBaseUrl(): string {
  return `http://${window.location.hostname}:8000`
}

// Lien direct vers le flux d'un device (évite la page liste de ws-scrcpy).
// udid d'un device réseau = "<ip>:5555". Players : webcodecs|mse|broadway|tinyh264.
export function streamUrl(ip: string, player: string): string {
  return `${remoteBaseUrl()}/#!action=stream&udid=${ip}:5555&player=${player}`
}

export type RemotePlayer = 'webcodecs' | 'mse' | 'broadway' | 'tinyh264'
export const REMOTE_PLAYERS: { id: RemotePlayer; label: string }[] = [
  { id: 'webcodecs', label: 'WebCodecs' },
  { id: 'mse', label: 'MSE (H264)' },
  { id: 'broadway', label: 'Broadway' },
  { id: 'tinyh264', label: 'Tiny H264' },
]

// Ouvre le miroir du device (RemoteScreen écoute cet événement).
export function launchRemote(ip?: string) {
  if (!ip) return
  window.dispatchEvent(new CustomEvent('hub:open-remote', { detail: { ip } }))
}

// Un miroir n'a de sens que pour un device Android joignable en ADB (pas le PC).
export function canRemote(d: Pick<Device, 'platform' | 'ip'>): boolean {
  return !!d.ip && d.platform !== 'pc_windows'
}
