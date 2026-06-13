import type { Device } from './api'

// Miroir d'écran via ws-scrcpy (conteneur sur le homelab, port 8000). On le sert
// depuis le même host que le Hub (le navigateur y accède en LAN). Embarqué en
// iframe dans une modale du Hub — pas de protocole externe, marche dans tout
// navigateur et depuis n'importe quel appareil du réseau.
export function remoteBaseUrl(): string {
  return `http://${window.location.hostname}:8000`
}

// Ouvre la modale miroir (RemoteScreen écoute cet événement).
export function launchRemote(_ip?: string) {
  window.dispatchEvent(new CustomEvent('hub:open-remote', { detail: { url: remoteBaseUrl() } }))
}

// Un miroir n'a de sens que pour un device Android joignable en ADB (pas le PC).
export function canRemote(d: Pick<Device, 'platform' | 'ip'>): boolean {
  return !!d.ip && d.platform !== 'pc_windows'
}
