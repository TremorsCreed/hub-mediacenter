import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { sendPlayCommand, isConnected, getConnectedIds } from '../ws'
import { AppId, CatalogEntry, WsPlayCommand } from '../types'

const router = Router()

// ZapScript: http.post||http://hub-backend:8020/api/zaparoo/scan||{"token":"{{TOKEN_TEXT}}","device_id":"shield-salon"}
router.post('/scan', async (req, res) => {
  const parsed = z.object({ token: z.string().min(1), device_id: z.string().optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { token, device_id } = parsed.data
  let entry: CatalogEntry | null = null

  // EAN mapping first, then catalog ID, then fuzzy title
  const { rows: eanRows } = await db.execute({
    sql: `SELECT c.* FROM catalog c LEFT JOIN ean_mappings e ON e.catalog_id = c.id WHERE c.ean = ? OR e.ean = ? LIMIT 1`,
    args: [token, token]
  })
  entry = (eanRows[0] as any) ?? null

  if (!entry) {
    const { rows } = await db.execute({ sql: 'SELECT * FROM catalog WHERE id = ?', args: [token] })
    entry = (rows[0] as any) ?? null
  }

  if (!entry) {
    const { rows } = await db.execute({
      sql: `SELECT * FROM catalog WHERE title ILIKE ? ORDER BY title LIMIT 1`,
      args: [`%${token}%`]
    })
    entry = (rows[0] as any) ?? null
  }

  if (!entry) return res.status(404).json({ error: 'media not found', token })

  let target_id = device_id
  if (!target_id) {
    for (const id of getConnectedIds()) {
      const { rows } = await db.execute({ sql: 'SELECT capabilities FROM devices WHERE id = ?', args: [id] })
      if (!rows.length) continue
      const caps = JSON.parse(rows[0].capabilities as string)
      if (caps.some((c: any) => c.can_receive.includes(entry!.type))) { target_id = id; break }
    }
  }

  if (!target_id || !isConnected(target_id)) return res.status(503).json({ error: 'no device available' })

  const { rows: devRows } = await db.execute({ sql: 'SELECT capabilities FROM devices WHERE id = ?', args: [target_id] })
  const caps = JSON.parse(devRows[0].capabilities as string)
  const cap = caps.find((c: any) => c.can_receive.includes(entry!.type))
  const resolved_app: AppId = cap?.app ?? 'plex'

  const cmd: WsPlayCommand = {
    type: 'play', catalog_id: entry.id, app: resolved_app, title: entry.title,
    plex_id: entry.plex_id ?? undefined, tivimate_channel: entry.tivimate_id ?? undefined, requester: 'zaparoo'
  }

  sendPlayCommand(target_id, cmd)

  await db.execute({
    sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester) VALUES (?, ?, ?, ?, ?, 'zaparoo')`,
    args: [target_id, entry.id, resolved_app, entry.title, Date.now()]
  })

  res.json({ ok: true, title: entry.title, device_id: target_id, app: resolved_app })
})

export default router
