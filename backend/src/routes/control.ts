import { Router } from 'express'
import { sendControl, isConnected } from '../ws'
import { db } from '../db'
import { notifyOverlay, hideOverlay } from '../notify'

const router = Router()

const ALLOWED_ACTIONS = new Set([
  'play_pause', 'play', 'pause', 'stop', 'next', 'previous',
  'volume_up', 'volume_down', 'mute', 'set_volume', 'seek'
])

router.post('/:deviceId/:action', async (req, res) => {
  const { deviceId, action } = req.params
  if (!ALLOWED_ACTIONS.has(action)) return res.status(400).json({ error: 'unknown action', action })
  if (!isConnected(deviceId)) return res.status(503).json({ error: 'device not connected', device_id: deviceId })

  // seek : position absolue en ms (?position=...), transmise à la session active.
  // set_volume : volume absolu 0-100 (?level=...), appliqué au stream MUSIC du device.
  let extra: Record<string, unknown> | undefined
  if (action === 'seek') {
    const position = parseInt((req.query.position as string) ?? '')
    if (!Number.isFinite(position) || position < 0) return res.status(400).json({ error: 'position (ms) requise' })
    extra = { position }
  } else if (action === 'set_volume') {
    const level = parseInt((req.query.level as string) ?? '')
    if (!Number.isFinite(level) || level < 0 || level > 100) return res.status(400).json({ error: 'level (0-100) requis' })
    extra = { level }
  }

  const ok = sendControl(deviceId, action, extra)
  if (!ok) return res.status(503).json({ error: 'failed to send control to device' })

  const overlayLabels: Record<string, string> = {
    stop: '■ Lecture arrêtée',
    pause: '❚❚ Pause',
    play: '▶ Lecture',
    play_pause: '▶❚❚ Play/Pause',
    next: '⏭ Suivant',
    previous: '⏮ Précédent',
    mute: '🔇 Muet',
  }
  if (overlayLabels[action]) {
    notifyOverlay(deviceId, { title: 'Hub MediaCenter', message: overlayLabels[action], duration: 2 })
  }
  if (action === 'stop') hideOverlay(deviceId)

  // Mise à jour optimiste du playback_state pour le feedback dashboard.
  // L'agent enverra un state_update qui réconciliera si besoin.
  if (action === 'stop') {
    await db.execute({
      sql: `UPDATE playback_state SET status='stopped' WHERE device_id=?`,
      args: [deviceId]
    })
  } else if (action === 'pause') {
    await db.execute({
      sql: `UPDATE playback_state SET status='paused' WHERE device_id=?`,
      args: [deviceId]
    })
  }

  res.json({ ok: true, action })
})

export default router
