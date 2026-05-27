// Notifications overlay sur les devices : utilise notre OverlayManager embarqué
// dans l'agent (WindowManager + SYSTEM_ALERT_WINDOW), envoyé via WS.
// Activable par device via device_config.tvoverlay_enabled.

import { db } from './db'
import { sendOverlay } from './ws'

export interface OverlayPayload {
  title: string
  message: string
  duration?: number
  image?: string
  image_kind?: 'poster' | 'logo'
  app_label?: string
}

async function getConfig(deviceId: string): Promise<{ enabled: boolean; playerDuration: number }> {
  try {
    const { rows } = await db.execute({
      sql: `SELECT COALESCE(dc.tvoverlay_enabled, 0) as enabled,
                   COALESCE(dc.overlay_player_duration, 0) as player_duration
            FROM devices d LEFT JOIN device_config dc ON dc.device_id = d.id
            WHERE d.id = ?`,
      args: [deviceId]
    })
    const r = rows[0] as any
    return { enabled: !!r?.enabled, playerDuration: Number(r?.player_duration ?? 0) }
  } catch { return { enabled: false, playerDuration: 0 } }
}

export async function notifyOverlay(deviceId: string, payload: OverlayPayload): Promise<void> {
  const cfg = await getConfig(deviceId)
  if (!cfg.enabled) return
  sendOverlay(deviceId, { style: 'small', duration: payload.duration ?? 4, ...payload })
}

export async function notifyOverlayPlayer(deviceId: string, payload: OverlayPayload): Promise<void> {
  const cfg = await getConfig(deviceId)
  if (!cfg.enabled) { console.log(`[overlay] disabled for ${deviceId}, skip`); return }
  const duration = payload.duration ?? cfg.playerDuration
  const ok = sendOverlay(deviceId, { style: 'player', duration, ...payload })
  console.log(`[overlay] player → ${deviceId}: title="${payload.title}" image=${payload.image ?? '(none)'} duration=${duration} sent=${ok}`)
}

export async function hideOverlay(deviceId: string): Promise<void> {
  const cfg = await getConfig(deviceId)
  if (!cfg.enabled) return
  sendOverlay(deviceId, { action: 'hide', message: '' })
}
