import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { isConnected } from '../ws'

const router = Router()

router.get('/', async (_req, res) => {
  const { rows } = await db.execute(`
    SELECT ps.*, d.name as device_name, c.title
    FROM playback_state ps
    LEFT JOIN devices d ON d.id = ps.device_id
    LEFT JOIN catalog c ON c.id = ps.catalog_id
    ORDER BY d.name
  `)
  res.json(rows.map((r: any) => ({ ...r, ws_connected: isConnected(r.device_id) })))
})

router.get('/history', async (_req, res) => {
  const { rows } = await db.execute(`
    SELECT h.*, d.name as device_name
    FROM playback_history h
    LEFT JOIN devices d ON d.id = h.device_id
    ORDER BY h.started_at DESC LIMIT 100
  `)
  res.json(rows)
})

router.get('/:device_id', async (req, res) => {
  const { rows } = await db.execute({
    sql: `SELECT ps.*, d.name as device_name, c.title
          FROM playback_state ps
          LEFT JOIN devices d ON d.id = ps.device_id
          LEFT JOIN catalog c ON c.id = ps.catalog_id
          WHERE ps.device_id = ?`,
    args: [req.params.device_id]
  })
  if (!rows.length) return res.status(404).json({ error: 'device not found' })
  const r = rows[0] as any
  res.json({ ...r, ws_connected: isConnected(r.device_id) })
})

const StateUpdateSchema = z.object({
  status: z.enum(['playing', 'paused', 'stopped', 'error']),
  catalog_id: z.string().optional(),
  app: z.string().optional()
})

router.post('/:device_id', async (req, res) => {
  const parsed = StateUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { status, catalog_id, app } = parsed.data
  await db.execute({
    sql: `UPDATE playback_state SET status = ?, catalog_id = ?, app = ?, started_at = ? WHERE device_id = ?`,
    args: [status, catalog_id ?? null, app ?? null, status === 'playing' ? Date.now() : null, req.params.device_id]
  })
  res.json({ ok: true })
})

export default router
