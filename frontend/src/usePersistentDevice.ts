import { useState, useCallback } from 'react'
import type { Device } from './api'

// Mémorise le device cible choisi par l'utilisateur dans le navigateur, pour qu'il
// TIENNE après un refresh (avant, chaque page repiquait le 1er device connecté →
// retour systématique sur "sujet21" / le PC). Le choix ne change que si l'utilisateur
// le change explicitement, ou si le device mémorisé n'existe plus.
const KEY = 'hub.selectedDeviceId'

// Pose le device cible hors React (utilisé à l'activation d'un profil qui a un
// device par défaut : la cible bascule dessus, puis reste modifiable librement).
export function setPersistedDevice(id: string) {
  try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function usePersistentDevice() {
  const [deviceId, setRaw] = useState<string>(() => {
    try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
  })

  const setDeviceId = useCallback((id: string) => {
    setRaw(id)
    try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY) } catch { /* ignore */ }
  }, [])

  // À appeler quand la liste des devices est connue. Garde le choix mémorisé s'il est
  // toujours valide ; sinon retombe sur un device connecté (puis n'importe lequel).
  const reconcile = useCallback((devices: Device[]) => {
    setRaw(prev => {
      if (prev && devices.some(d => d.id === prev)) return prev
      const next = (devices.find(d => d.ws_connected) ?? devices[0])?.id ?? ''
      try { next ? localStorage.setItem(KEY, next) : localStorage.removeItem(KEY) } catch { /* ignore */ }
      return next
    })
  }, [])

  return { deviceId, setDeviceId, reconcile }
}
