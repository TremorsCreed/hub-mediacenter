import { useState, useCallback, useEffect } from 'react'
import type { Device } from './api'

// Mémorise le device cible choisi par l'utilisateur dans le navigateur, pour qu'il
// TIENNE après un refresh (avant, chaque page repiquait le 1er device connecté →
// retour systématique sur "sujet21" / le PC). Le choix ne change que si l'utilisateur
// le change explicitement, ou si le device mémorisé n'existe plus.
const KEY = 'hub.selectedDeviceId'
const EVT = 'hub:device-changed'

function writeDevice(id: string) {
  try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY) } catch { /* ignore */ }
  // localStorage n'est pas réactif dans le même document → on notifie les autres
  // composants (ex. la barre « lecture en cours ») qu'on a changé de cible.
  try { window.dispatchEvent(new Event(EVT)) } catch { /* ignore */ }
}

export function readPersistedDevice(): string {
  try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
}

// Pose le device cible hors React (utilisé à l'activation d'un profil qui a un
// device par défaut : la cible bascule dessus, puis reste modifiable librement).
export function setPersistedDevice(id: string) {
  writeDevice(id)
}

// S'abonne au device cible courant (lecture seule, réactif aux changements).
export function useCurrentDeviceId(): string {
  const [deviceId, setDeviceId] = useState<string>(readPersistedDevice)
  useEffect(() => {
    const onChange = () => setDeviceId(readPersistedDevice())
    window.addEventListener(EVT, onChange)
    return () => window.removeEventListener(EVT, onChange)
  }, [])
  return deviceId
}

export function usePersistentDevice() {
  const [deviceId, setRaw] = useState<string>(readPersistedDevice)

  // Suit aussi les changements faits ailleurs (autre page, activation de profil).
  useEffect(() => {
    const onChange = () => setRaw(readPersistedDevice())
    window.addEventListener(EVT, onChange)
    return () => window.removeEventListener(EVT, onChange)
  }, [])

  const setDeviceId = useCallback((id: string) => {
    setRaw(id)
    writeDevice(id)
  }, [])

  // À appeler quand la liste des devices est connue. Garde le choix mémorisé s'il est
  // toujours valide ; sinon retombe sur un device connecté (puis n'importe lequel).
  const reconcile = useCallback((devices: Device[]) => {
    setRaw(prev => {
      if (prev && devices.some(d => d.id === prev)) return prev
      const next = (devices.find(d => d.ws_connected) ?? devices[0])?.id ?? ''
      writeDevice(next)
      return next
    })
  }, [])

  return { deviceId, setDeviceId, reconcile }
}
