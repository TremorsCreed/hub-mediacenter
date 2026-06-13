import type { Device } from './api'

// Miroir d'écran via ws-scrcpy (conteneur homelab, port 8000), embarqué en iframe.
export function remoteBaseUrl(): string {
  return `http://${window.location.hostname}:8000`
}

export type RemotePlayer = 'mse' | 'webcodecs' | 'broadway' | 'tinyh264'
export const REMOTE_PLAYERS: { id: RemotePlayer; label: string }[] = [
  { id: 'mse', label: 'H264 Converter' },
  { id: 'webcodecs', label: 'WebCodecs' },
  { id: 'broadway', label: 'Broadway' },
  { id: 'tinyh264', label: 'Tiny H264' },
]

// Lien DIRECT vers le flux d'un device. ws-scrcpy passe par un proxy-adb dont le
// port distant est fixe (tcp:8886, le port d'écoute du scrcpy-server). Le param
// `ws=` encode l'URL du proxy (double-encodage : ses propres params sont encodés
// une fois, puis le tout est ré-encodé). Format reconstitué depuis une URL réelle.
export function streamUrl(ip: string, player: RemotePlayer): string {
  const host = window.location.hostname
  const base = `http://${host}:8000`
  const udid = `${ip}:5555`
  const innerWs =
    `ws://${host}:8000/?action=proxy-adb` +
    `&remote=${encodeURIComponent('tcp:8886')}` +
    `&udid=${encodeURIComponent(udid)}`
  return `${base}/#!action=stream` +
    `&udid=${encodeURIComponent(udid)}` +
    `&player=${player}` +
    `&ws=${encodeURIComponent(innerWs)}`
}

// Ouvre le miroir du device (RemoteScreen écoute cet événement).
export function launchRemote(ip?: string) {
  if (!ip) return
  window.dispatchEvent(new CustomEvent('hub:open-remote', { detail: { ip } }))
}

// Un miroir n'a de sens que pour un device Android joignable en ADB (pas le PC).
export function canRemote(d: Pick<Device, 'platform' | 'ip'>): boolean {
  return !!d.ip && d.platform !== 'pc_windows'
}
