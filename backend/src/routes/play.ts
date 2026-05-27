import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { sendPlayCommand, isConnected, getConnectedIds } from '../ws'
import { AppId, CatalogEntry, RequesterType, WsPlayCommand } from '../types'
import { resolvePlexWatchUrl } from './plex'

const router = Router()

const PlaySchema = z.object({
  query: z.string().optional(),
  catalog_id: z.string().optional(),
  ean: z.string().optional(),
  device_id: z.string().optional(),
  app: z.string().optional(),
  requester: z.enum(['zaparoo', 'llm', 'n8n', 'manual', 'ha']).default('manual')
})

router.post('/', async (req, res) => {
  const parsed = PlaySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { query, catalog_id, ean, device_id, app, requester } = parsed.data

  // 1. Resolve catalog entry
  let entry: CatalogEntry | null = null

  if (catalog_id) {
    const { rows } = await db.execute({ sql: 'SELECT * FROM catalog WHERE id = ?', args: [catalog_id] })
    entry = (rows[0] as any) ?? null
  } else if (ean) {
    const { rows } = await db.execute({
      sql: `SELECT c.* FROM catalog c LEFT JOIN ean_mappings e ON e.catalog_id = c.id
            WHERE c.ean = ? OR e.ean = ? LIMIT 1`,
      args: [ean, ean]
    })
    entry = (rows[0] as any) ?? null
  } else if (query) {
    const { rows } = await db.execute({
      sql: `SELECT * FROM catalog WHERE title LIKE ? ORDER BY title LIMIT 1`,
      args: [`%${query}%`]
    })
    entry = (rows[0] as any) ?? null
  }

  if (!entry) return res.status(404).json({ error: 'media not found', query, ean, catalog_id })

  // 2. Resolve target device
  let target_device_id = device_id

  if (!target_device_id) {
    for (const id of getConnectedIds()) {
      const { rows } = await db.execute({ sql: 'SELECT capabilities FROM devices WHERE id = ?', args: [id] })
      if (!rows.length) continue
      const caps = JSON.parse(rows[0].capabilities as string)
      if (caps.some((c: any) => c.can_receive.includes(entry!.type))) {
        target_device_id = id
        break
      }
    }
  }

  if (!target_device_id) return res.status(503).json({ error: 'no device available for this media type' })
  if (!isConnected(target_device_id)) return res.status(503).json({ error: 'device not connected', device_id: target_device_id })

  // 3. Resolve app
  const { rows: devRows } = await db.execute({ sql: 'SELECT capabilities FROM devices WHERE id = ?', args: [target_device_id] })
  const caps = JSON.parse(devRows[0].capabilities as string)
  let resolved_app: AppId = app as AppId
  if (!resolved_app) {
    const cap = caps.find((c: any) => c.can_receive.includes(entry!.type))
    resolved_app = cap?.app ?? 'plex'
  }

  // 4. Résolution du watch URL Plex si applicable
  let plex_watch_url: string | undefined
  if (resolved_app === 'plex' && entry.plex_id) {
    plex_watch_url = await resolvePlexWatchUrl(entry.plex_id) ?? undefined
  }

  // 5. Send to agent
  const cmd: WsPlayCommand = {
    type: 'play',
    catalog_id: entry.id,
    app: resolved_app,
    title: entry.title,
    plex_id: entry.plex_id ?? undefined,
    plex_watch_url,
    tivimate_channel: entry.tivimate_id ?? undefined,
    requester: requester as RequesterType
  }

  if (!sendPlayCommand(target_device_id, cmd)) {
    return res.status(503).json({ error: 'failed to send command to device' })
  }

  await db.execute({
    sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester]
  })

  res.json({ ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app })
})

export default router
