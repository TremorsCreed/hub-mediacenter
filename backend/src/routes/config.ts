import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { agents } from '../ws'

const router = Router({ mergeParams: true })

const ConfigSchema = z.object({
  xtream_server: z.string().default(''),
  xtream_user: z.string().default(''),
  xtream_pass: z.string().default(''),
  xtream_ext: z.string().default('ts'),
  plex_server_id: z.string().default(''),
  app_mappings: z.record(z.string()).default({})
})

router.get('/', async (req, res) => {
  const id = (req as any).params.id as string
  const { rows } = await db.execute({ sql: 'SELECT * FROM device_config WHERE device_id = ?', args: [id] })
  if (!rows.length) {
    return res.json({ xtream_server: '', xtream_user: '', xtream_pass: '', xtream_ext: 'ts', app_mappings: {} })
  }
  const r = rows[0] as any
  res.json({ ...r, app_mappings: JSON.parse(r.app_mappings as string) })
})

router.put('/', async (req, res) => {
  const id = (req as any).params.id as string
  const parsed = ConfigSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { xtream_server, xtream_user, xtream_pass, xtream_ext, plex_server_id, app_mappings } = parsed.data
  await db.execute({
    sql: `INSERT INTO device_config (device_id, xtream_server, xtream_user, xtream_pass, xtream_ext, plex_server_id, app_mappings, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            xtream_server = excluded.xtream_server,
            xtream_user = excluded.xtream_user,
            xtream_pass = excluded.xtream_pass,
            xtream_ext = excluded.xtream_ext,
            plex_server_id = excluded.plex_server_id,
            app_mappings = excluded.app_mappings,
            updated_at = excluded.updated_at`,
    args: [id, xtream_server, xtream_user, xtream_pass, xtream_ext, plex_server_id, JSON.stringify(app_mappings), Date.now()]
  })

  // Push config to agent if connected
  const agent = agents.get(id)
  if (agent?.ws.readyState === 1) {
    agent.ws.send(JSON.stringify({
      type: 'config',
      xtream_server, xtream_user, xtream_pass, xtream_ext, plex_server_id, app_mappings
    }))
  }

  res.json({ ok: true })
})

export default router
