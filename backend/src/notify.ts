// Notifications overlay sur les devices : utilise notre OverlayManager embarqué
// dans l'agent (WindowManager + SYSTEM_ALERT_WINDOW), envoyé via WS.
// Activable par device via device_config.tvoverlay_enabled.

import { db } from './db'
import { sendOverlay } from './ws'

export interface OverlayPayload {
  title: string
  message: string
  duration?: number
  image?: string       // URL absolue accessible depuis le device
  app_label?: string
}

async function isEnabled(deviceId: string): Promise<boolean> {
  try {
    const { rows } = await db.execute({
      sql: `SELECT COALESCE(dc.tvoverlay_enabled, 0) as enabled
            FROM devices d LEFT JOIN device_config dc ON dc.device_id = d.id
            WHERE d.id = ?`,
      args: [deviceId]
    })
    return !!(rows[0] as any)?.enabled
  } catch { return false }
}

// Petite notif en haut-droite, auto-hide (préparation, contrôles)
export async function notifyOverlay(deviceId: string, payload: OverlayPayload): Promise<void> {
  if (!(await isEnabled(deviceId))) return
  sendOverlay(deviceId, { style: 'small', duration: payload.duration ?? 4, ...payload })
}

// Belle card pleine largeur en bas, persistante (le temps du film)
export async function notifyOverlayPlayer(deviceId: string, payload: OverlayPayload): Promise<void> {
  if (!(await isEnabled(deviceId))) return
  sendOverlay(deviceId, { style: 'player', duration: payload.duration ?? 0, ...payload })
}

export async function hideOverlay(deviceId: string): Promise<void> {
  if (!(await isEnabled(deviceId))) return
  sendOverlay(deviceId, { action: 'hide', message: '' })
}
