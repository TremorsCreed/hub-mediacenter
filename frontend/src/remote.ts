import type { Device } from './api'

// Lance le miroir/contrôle scrcpy d'un device via le protocole Windows custom
// `hubremote://<ip>` (gestionnaire C:\Scripts\hub-remote.ps1 enregistré sur le PC).
// Ne marche que depuis un PC où le protocole + scrcpy sont installés (le cas de
// test de David) ; ailleurs le navigateur affichera juste une erreur de protocole.
export function launchRemote(ip?: string) {
  if (!ip) return
  window.location.href = `hubremote://${ip}`
}

// Un « remote » n'a de sens que pour un device Android joignable en ADB (pas le
// PC lui-même), et on a besoin de son IP.
export function canRemote(d: Pick<Device, 'platform' | 'ip'>): boolean {
  return !!d.ip && d.platform !== 'pc_windows'
}
