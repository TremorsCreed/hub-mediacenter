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
  app_mappings: z.record(z.string()).default({}),
  xtream_credential_id: z.number().nullable().optional(),
  tvoverlay_enabled: z.boolean().default(false),
  overlay_player_duration: z.number().int().min(0).max(600).default(0),
  iptv_player: z.enum(['auto', 'mxplayer', 'vlc', 'tivimate']).default('auto')
})

async function resolveXtream(credId: number | null | undefined, fallback: { xtream_server: string; xtream_user: string; xtream_pass: string; xtream_ext: string }) {
  if (!credId) return fallback
  const { rows } = await db.execute({ sql: 'SELECT data FROM credentials WHERE id = ? AND type = ?', args: [credId, 'xtream'] })
  if (!rows.length) return fallback
  const data = JSON.parse((rows[0] as any).data as string)
  return {
    xtream_server: data.server ?? '',
    xtream_user: data.user ?? '',
    xtream_pass: data.pass ?? '',
    xtream_ext: data.ext ?? 'ts'
  }
}

router.get('/', async (req, res) => {
  const id = (req as any).params.id as string
  const { rows } = await db.execute({ sql: 'SELECT * FROM device_config WHERE device_id = ?', args: [id] })
  if (!rows.length) {
    return res.json({ xtream_server: '', xtream_user: '', xtream_pass: '', xtream_ext: 'ts', plex_server_id: '', app_mappings: {}, xtream_credential_id: null, tvoverlay_enabled: false, overlay_player_duration: 0, iptv_player: 'auto' })
  }
  const r = rows[0] as any
  const resolved = await resolveXtream(r.xtream_credential_id, r)
  res.json({
    ...r,
    ...resolved,
    app_mappings: JSON.parse(r.app_mappings as string),
    xtream_credential_id: r.xtream_credential_id ?? null,
    tvoverlay_enabled: !!r.tvoverlay_enabled,
    overlay_player_duration: r.overlay_player_duration ?? 0,
    iptv_player: r.iptv_player ?? 'auto'
  })
})

router.put('/', async (req, res) => {
  const id = (req as any).params.id as string
  const parsed = ConfigSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { xtream_server, xtream_user, xtream_pass, xtream_ext, plex_server_id, app_mappings, xtream_credential_id, tvoverlay_enabled, overlay_player_duration, iptv_player } = parsed.data
  await db.execute({
    sql: `INSERT INTO device_config (device_id, xtream_server, xtream_user, xtream_pass, xtream_ext, plex_server_id, app_mappings, xtream_credential_id, tvoverlay_enabled, overlay_player_duration, iptv_player, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            xtream_server = excluded.xtream_server,
            xtream_user = excluded.xtream_user,
            xtream_pass = excluded.xtream_pass,
            xtream_ext = excluded.xtream_ext,
            plex_server_id = excluded.plex_server_id,
            app_mappings = excluded.app_mappings,
            xtream_credential_id = excluded.xtream_credential_id,
            tvoverlay_enabled = excluded.tvoverlay_enabled,
            overlay_player_duration = excluded.overlay_player_duration,
            iptv_player = excluded.iptv_player,
            updated_at = excluded.updated_at`,
    args: [id, xtream_server, xtream_user, xtream_pass, xtream_ext, plex_server_id, JSON.stringify(app_mappings), xtream_credential_id ?? null, tvoverlay_enabled ? 1 : 0, overlay_player_duration, iptv_player, Date.now()]
  })

  // Résoudre les credentials Xtream effectifs avant de pousser à l'agent
  const effective = await resolveXtream(xtream_credential_id, { xtream_server, xtream_user, xtream_pass, xtream_ext })

  const agent = agents.get(id)
  if (agent?.ws.readyState === 1) {
    agent.ws.send(JSON.stringify({
      type: 'config',
      ...effective,
      plex_server_id, app_mappings, iptv_player
    }))
  }

  res.json({ ok: true })
})

export default router
