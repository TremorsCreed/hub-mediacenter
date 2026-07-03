import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { setRefreshHours } from '../iptvVodCache'

// Réglages globaux de l'app (singleton app_settings id=1). Monté derrière requireAdmin.
const router = Router()

router.get('/', async (_req, res) => {
  const { rows } = await db.execute('SELECT iptv_refresh_hours FROM app_settings WHERE id = 1')
  const iptv_refresh_hours = rows.length ? Number((rows[0] as any).iptv_refresh_hours) : 24
  res.json({ iptv_refresh_hours })
})

const Schema = z.object({
  // 1h à 168h (7 jours). Espacer = moins d'appels au provider IPTV (anti-ban).
  iptv_refresh_hours: z.number().int().min(1).max(168),
})

router.put('/', async (req, res) => {
  const parsed = Schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const h = parsed.data.iptv_refresh_hours
  await db.execute({ sql: 'UPDATE app_settings SET iptv_refresh_hours = ? WHERE id = 1', args: [h] })
  setRefreshHours(h) // prise en compte à chaud, sans redémarrage
  res.json({ ok: true, iptv_refresh_hours: h })
})

export default router
