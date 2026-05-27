// Helper TvOverlay (app Android TV qui affiche des notifications visuelles
// en overlay). Best-effort : si TvOverlay n'est pas installé ou ne répond
// pas, on swallow l'erreur — pas de blocage du flux de play.
//
// API : POST http://{deviceIp}:5001/notify avec JSON {title, message, duration?, image?}

export interface OverlayPayload {
  title: string
  message: string
  duration?: number  // secondes
  image?: string     // URL d'icône optionnelle
}

const PORT = 5001
const TIMEOUT_MS = 1500

export async function notifyOverlay(deviceIp: string | undefined | null, payload: OverlayPayload): Promise<void> {
  if (!deviceIp) return
  try {
    await fetch(`http://${deviceIp}:${PORT}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 4, ...payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS) as any,
    })
  } catch {
    // silent — TvOverlay pas installé, device offline, etc.
  }
}
