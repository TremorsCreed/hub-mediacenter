import type { Device } from './api'

// Miroir d'écran via ws-scrcpy (conteneur sur le homelab, port 8000), embarqué
// en iframe dans le Hub (PIP épinglable ou plein écran). ws-scrcpy établit un
// proxy WebSocket dynamique par session → pas de deep-link figé fiable : on
// charge sa page liste et l'utilisateur clique le device (1 clic).
export function remoteBaseUrl(): string {
  return `http://${window.location.hostname}:8000`
}

// Ouvre le miroir (RemoteScreen écoute cet événement).
export function launchRemote(ip?: string) {
  if (!ip) return
  window.dispatchEvent(new CustomEvent('hub:open-remote', { detail: { ip } }))
}

// Un miroir n'a de sens que pour un device Android joignable en ADB (pas le PC).
export function canRemote(d: Pick<Device, 'platform' | 'ip'>): boolean {
  return !!d.ip && d.platform !== 'pc_windows'
}
