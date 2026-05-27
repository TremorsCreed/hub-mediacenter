import { Router } from 'express'
import { sendControl, isConnected } from '../ws'
import { db } from '../db'

const router = Router()

const ALLOWED_ACTIONS = new Set([
  'play_pause', 'play', 'pause', 'stop', 'next', 'previous',
  'volume_up', 'volume_down', 'mute'
])

router.post('/:deviceId/:action', async (req, res) => {
  const { deviceId, action } = req.params
  if (!ALLOWED_ACTIONS.has(action)) return res.status(400).json({ error: 'unknown action', action })
  if (!isConnected(deviceId)) return res.status(503).json({ error: 'device not connected', device_id: deviceId })

  const ok = sendControl(deviceId, action)
  if (!ok) return res.status(503).json({ error: 'failed to send control to device' })

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
  } else if (action === 'play' || action === 'play_pause') {
    // Pour play_pause on ne sait pas si ça reprend ou pause ; on laisse l'agent gérer.
  }

  res.json({ ok: true, action })
})

export default router
