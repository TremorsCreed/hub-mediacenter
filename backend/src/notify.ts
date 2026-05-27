// Module TvOverlay (notifications visuelles Android TV).
// Activable par device dans la page Devices — désactivé par défaut.
// API : POST http://{deviceIp}:5001/notify avec JSON {title, message, duration?, image?}

import { db } from './db'

export interface OverlayPayload {
  title: string
  message: string
  duration?: number  // secondes
  image?: string
}

const PORT = 5001
const TIMEOUT_MS = 1500

/**
 * Envoie une notif TvOverlay au device — seulement si tvoverlay_enabled=1
 * dans device_config ET si on connaît l'IP du device.
 * Best-effort : swallow toutes les erreurs, n'impacte jamais le flow appelant.
 */
export async function notifyOverlay(deviceId: string, payload: OverlayPayload): Promise<void> {
  try {
    const { rows } = await db.execute({
      sql: `SELECT d.ip, COALESCE(dc.tvoverlay_enabled, 0) as enabled
            FROM devices d
            LEFT JOIN device_config dc ON dc.device_id = d.id
            WHERE d.id = ?`,
      args: [deviceId]
    })
    const row = rows[0] as any
    if (!row || !row.enabled || !row.ip) return
    await fetch(`http://${row.ip}:${PORT}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 4, ...payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS) as any,
    })
  } catch { /* silent */ }
}
