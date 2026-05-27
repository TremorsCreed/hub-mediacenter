// Notifications overlay sur les devices : utilise notre propre OverlayManager
// embarqué dans l'agent (WindowManager + SYSTEM_ALERT_WINDOW), envoyé via WS.
// Plus besoin de l'app tierce TvOverlay.
//
// Activable par device via device_config.tvoverlay_enabled (le nom du flag est
// conservé pour rétrocompat ; renommer en overlay_enabled à la prochaine
// migration si on veut clarifier).

import { db } from './db'
import { sendOverlay } from './ws'

export interface OverlayPayload {
  title: string
  message: string
  duration?: number  // secondes
  image?: string
}

export async function notifyOverlay(deviceId: string, payload: OverlayPayload): Promise<void> {
  try {
    const { rows } = await db.execute({
      sql: `SELECT COALESCE(dc.tvoverlay_enabled, 0) as enabled
            FROM devices d
            LEFT JOIN device_config dc ON dc.device_id = d.id
            WHERE d.id = ?`,
      args: [deviceId]
    })
    const row = rows[0] as any
    if (!row || !row.enabled) return
    sendOverlay(deviceId, {
      title: payload.title,
      message: payload.message,
      duration: payload.duration ?? 4,
    })
  } catch { /* silent */ }
}
