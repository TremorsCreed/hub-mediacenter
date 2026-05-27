import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { sendPlayCommand, sendNotify, isConnected, getConnectedIds } from '../ws'
import { AppId, CatalogEntry, RequesterType, WsPlayCommand } from '../types'
import { resolvePlexWatchUrl } from './plex'

async function waitForPlexClient(deviceIp: string, maxMs: number = 10000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`http://${deviceIp}:32500/resources`, { signal: AbortSignal.timeout(700) } as any)
      if (r.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}

async function plexRemotePlay(deviceIp: string, ratingKey: string, plexToken: string, plexServerUrl: string, machineId: string): Promise<boolean> {
  const playerBase = `http://${deviceIp}:32500/player/playback`
  const serverUrl = new URL(plexServerUrl)
  const serverPort = serverUrl.port || '32400'
  const commonHeaders = {
    'X-Plex-Client-Identifier': 'hub-mediacenter',
    'X-Plex-Product': 'Hub MediaCenter',
    'X-Plex-Version': '1.0.0',
    'X-Plex-Platform': 'Linux',
    'X-Plex-Device-Name': 'Hub MediaCenter',
  }
  try {
    // 1. Créer un PlayQueue sur le serveur Plex
    const uri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKey}`
    const queueParams = new URLSearchParams({
      type: 'video',
      uri,
      continuous: '0',
      shuffle: '0',
      repeat: '0',
      includeChapters: '1',
    })
    const queueRes = await fetch(`${plexServerUrl}/playQueues?${queueParams}`, {
      method: 'POST',
      headers: { ...commonHeaders, 'X-Plex-Token': plexToken, Accept: 'application/json' },
    })
    if (!queueRes.ok) {
      console.error('[plex] playQueue creation failed:', queueRes.status, await queueRes.text())
      return false
    }
    const queueData: any = await queueRes.json()
    const playQueueID = queueData?.MediaContainer?.playQueueID
    if (!playQueueID) {
      console.error('[plex] no playQueueID in response:', JSON.stringify(queueData).slice(0, 300))
      return false
    }

    // 2. Récupérer le machineIdentifier du player Shield (X-Plex-Target-Client-Identifier)
    let targetClientId = ''
    try {
      const resRes = await fetch(`http://${deviceIp}:32500/resources`, { headers: commonHeaders })
      const xml = await resRes.text()
      const m = xml.match(/machineIdentifier="([^"]+)"/)
      targetClientId = m?.[1] ?? ''
    } catch {}

    // 3. Stop la lecture en cours (double stop + wait long pour fiabilité)
    const stopHeaders = { ...commonHeaders, 'X-Plex-Token': plexToken }
    await fetch(`${playerBase}/stop?type=video`, { method: 'POST', headers: stopHeaders }).catch(() => {})
    await new Promise(r => setTimeout(r, 500))
    await fetch(`${playerBase}/stop?type=video`, { method: 'POST', headers: stopHeaders }).catch(() => {})
    await new Promise(r => setTimeout(r, 2000))

    // 4. Envoyer playMedia au player avec le containerKey du PlayQueue
    const playParams = new URLSearchParams({
      key: `/library/metadata/${ratingKey}`,
      offset: '0',
      machineIdentifier: machineId,
      address: serverUrl.hostname,
      port: serverPort,
      protocol: 'http',
      containerKey: `/playQueues/${playQueueID}?own=1&window=200`,
      token: plexToken,
      commandID: '1',
      providerIdentifier: 'com.plexapp.plugins.library',
      type: 'video',
    })
    const playHeaders: Record<string, string> = {
      ...commonHeaders,
      'X-Plex-Token': plexToken,
    }
    if (targetClientId) playHeaders['X-Plex-Target-Client-Identifier'] = targetClientId
    const r = await fetch(`${playerBase}/playMedia?${playParams}`, { method: 'POST', headers: playHeaders })
    if (!r.ok) console.error('[plex] playMedia failed:', r.status, await r.text())
    return r.ok
  } catch (e) {
    console.error('[plex] remote play error:', e)
    return false
  }
}

const router = Router()

const PlaySchema = z.object({
  query: z.string().optional(),
  catalog_id: z.string().optional(),
  ean: z.string().optional(),
  plex_id: z.string().optional(),
  iptv_stream_id: z.string().optional(),
  iptv_type: z.enum(['live', 'vod']).optional(),
  title: z.string().optional(),
  device_id: z.string().optional(),
  app: z.string().optional(),
  requester: z.enum(['zaparoo', 'llm', 'n8n', 'manual', 'ha']).default('manual')
})

router.post('/', async (req, res) => {
  const parsed = PlaySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { query, catalog_id, ean, plex_id, iptv_stream_id, iptv_type, title, device_id, app, requester } = parsed.data

  // 1. Resolve catalog entry
  let entry: CatalogEntry | null = null

  if (plex_id) {
    entry = { id: `plex:${plex_id}`, title: title ?? 'Plex', type: 'movie', plex_id } as CatalogEntry
  } else if (iptv_stream_id) {
    entry = {
      id: `iptv:${iptv_stream_id}`,
      title: title ?? 'IPTV',
      type: (iptv_type === 'vod' ? 'vod' : 'live_channel') as any,
      tivimate_id: iptv_stream_id,
    } as CatalogEntry
  } else if (catalog_id) {
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

  // 4. Plex : Remote Control API directe sur le player (port 32500)
  if (resolved_app === 'plex' && entry.plex_id) {
    const { rows: plexRows } = await db.execute('SELECT auth_token, server_url, server_machine_id FROM plex_config WHERE id = 1')
    const plexCfg = plexRows[0] as any
    const { rows: devIpRows } = await db.execute({ sql: 'SELECT ip FROM devices WHERE id = ?', args: [target_device_id] })
    const deviceIp = devIpRows[0]?.ip as string | undefined

    if (plexCfg?.auth_token && plexCfg?.server_url && deviceIp) {
      // Pré-condition : Plex doit être ouvert et idle. On le réveille via l'agent
      // (PlexLauncher.launchHome quand plex_id est vide), puis on attend que l'app
      // soit au premier plan avant d'envoyer la commande Remote Control.
      const wakeCmd: WsPlayCommand = {
        type: 'play',
        catalog_id: entry.id,
        app: 'plex',
        title: entry.title,
        requester: requester as RequesterType,
      }
      // Burst de wakes pour contourner les restrictions Android 12+ sur les background
      // activity starts. Si une autre app plein écran est active (YouTube, etc.) un seul
      // Intent peut être filtré ; en envoyer 3 espacés améliore les chances.
      const t0 = Date.now()
      for (let i = 0; i < 3; i++) {
        const woke = sendPlayCommand(target_device_id, wakeCmd)
        console.log(`[plex] wake #${i + 1} sent: ${woke}`)
        if (i < 2) await new Promise(r => setTimeout(r, 700))
      }
      await new Promise(r => setTimeout(r, 1500))
      const ready = await waitForPlexClient(deviceIp, 15000)
      console.log(`[plex] client ready=${ready} after ${Date.now() - t0}ms`)

      if (!ready) {
        return res.status(503).json({
          error: 'Plex injoignable sur le device. Ferme l\'app en cours sur le Shield (YouTube/autre) et réessaie.',
          hint: 'android_foreground_blocked',
        })
      }

      const ok = await plexRemotePlay(deviceIp, entry.plex_id, plexCfg.auth_token, plexCfg.server_url, plexCfg.server_machine_id)
      if (!ok) return res.status(502).json({ error: 'plex remote control failed' })

      // Update playback_state — sinon le dashboard reste sur "idle" pour les plays
      // qui passent par Remote Control (ils ne déclenchent pas de state_update WS).
      await db.execute({
        sql: `UPDATE playback_state SET status='playing', catalog_id=?, title=?, app='plex', started_at=? WHERE device_id=?`,
        args: [entry.id, entry.title, Date.now(), target_device_id]
      })

      // PAS de focus intent post Remote Control : la permission SYSTEM_ALERT_WINDOW
      // permet désormais au wake initial d'amener Plex au foreground, et un deep
      // link envoyé après le playMedia ferait switcher Plex sur la page détail au
      // lieu du player → lecture annulée.

      sendNotify(target_device_id, `Playing: ${entry.title}`)
      await db.execute({
        sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester]
      })
      console.log(`[plex] remote control ok: ${entry.title} → ${target_device_id}`)
      return res.json({ ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app })
    }
    // Fallback : watch URL via agent si pas de config Plex
    const plex_watch_url = await resolvePlexWatchUrl(entry.plex_id) ?? undefined
    const cmd: WsPlayCommand = { type: 'play', catalog_id: entry.id, app: resolved_app, title: entry.title, plex_id: entry.plex_id, plex_watch_url, requester: requester as RequesterType }
    if (!sendPlayCommand(target_device_id, cmd)) return res.status(503).json({ error: 'failed to send command to device' })
    await db.execute({ sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester) VALUES (?, ?, ?, ?, ?, ?)`, args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester] })
    return res.json({ ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app })
  }

  // 5. Autres apps : WebSocket vers l'agent
  const cmd: WsPlayCommand = {
    type: 'play',
    catalog_id: entry.id,
    app: resolved_app,
    title: entry.title,
    plex_id: entry.plex_id ?? undefined,
    tivimate_channel: entry.tivimate_id ?? undefined,
    iptv_type: iptv_type ?? (entry.type === 'vod' ? 'vod' : entry.type === 'live_channel' ? 'live' : undefined),
    requester: requester as RequesterType
  }

  if (!sendPlayCommand(target_device_id, cmd)) {
    return res.status(503).json({ error: 'failed to send command to device' })
  }

  await db.execute({
    sql: `UPDATE playback_state SET status='playing', catalog_id=?, title=?, app=?, started_at=? WHERE device_id=?`,
    args: [entry.id, entry.title, resolved_app, Date.now(), target_device_id]
  })

  await db.execute({
    sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester]
  })

  res.json({ ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app })
})

export default router
