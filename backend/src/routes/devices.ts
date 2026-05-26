import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { isConnected } from '../ws'
import { Device } from '../types'

const router = Router()

router.get('/', async (_req, res) => {
  const { rows } = await db.execute('SELECT * FROM devices ORDER BY last_seen DESC')
  const devices: Device[] = rows.map((r: any) => ({
    ...r,
    capabilities: JSON.parse(r.capabilities as string),
    ws_connected: isConnected(r.id as string)
  }))
  res.json(devices)
})

router.get('/:id', async (req, res) => {
  const { rows } = await db.execute({ sql: 'SELECT * FROM devices WHERE id = ?', args: [req.params.id] })
  if (!rows.length) return res.status(404).json({ error: 'device not found' })
  const r = rows[0] as any
  res.json({ ...r, capabilities: JSON.parse(r.capabilities), ws_connected: isConnected(r.id) })
})

const RegisterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  platform: z.enum(['android_tv', 'fire_tv', 'shield', 'apple_tv', 'roku', 'kodi', 'other']),
  ip: z.string().optional(),
  capabilities: z.array(z.object({
    app: z.string(),
    package: z.string().optional(),
    can_receive: z.array(z.string()),
    launch_method: z.string()
  })).default([])
})

router.post('/register', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { id, name, platform, ip, capabilities } = parsed.data
  await db.execute({
    sql: `INSERT INTO devices (id, name, platform, ip, last_seen, capabilities)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, platform = excluded.platform,
            ip = excluded.ip, last_seen = excluded.last_seen,
            capabilities = excluded.capabilities`,
    args: [id, name, platform, ip ?? null, Date.now(), JSON.stringify(capabilities)]
  })
  await db.execute({
    sql: `INSERT INTO playback_state (device_id, status) VALUES (?, 'stopped') ON CONFLICT(device_id) DO NOTHING`,
    args: [id]
  })
  res.status(201).json({ ok: true, id })
})

router.delete('/:id', async (req, res) => {
  const result = await db.execute({ sql: 'DELETE FROM devices WHERE id = ?', args: [req.params.id] })
  if (!result.rowsAffected) return res.status(404).json({ error: 'device not found' })
  res.json({ ok: true })
})

export default router
