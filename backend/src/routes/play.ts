import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { sendPlayCommand, sendNotify, isConnected, getConnectedIds } from '../ws'
import { AppId, CatalogEntry, RequesterType, WsPlayCommand } from '../types'
import { resolvePlexWatchUrl } from './plex'
import { spotifyFetch, MAISON_USER_ID } from './spotify'
import { notifyOverlay, notifyOverlayPlayer, hideOverlay } from '../notify'

// Helper pour construire l'URL stream Xtream complète côté backend.
// On résout l'extension réelle pour les VOD via get_vod_info (container_extension).
// Pour series, le streamId est en réalité l'episode_id et l'extension est fournie
// par le frontend (déjà récupérée via get_series_info à l'ouverture de la série).
async function buildIptvStreamUrl(
  deviceId: string,
  streamId: string,
  type: 'live' | 'vod' | 'series',
  explicitExt?: string,
): Promise<{ url: string; container: string } | null> {
  const { rows: cfgRows } = await db.execute({ sql: 'SELECT * FROM device_config WHERE device_id = ?', args: [deviceId] })
  const cfg = cfgRows[0] as any | undefined
  let server = '', user = '', pass = '', ext = 'ts'
  if (cfg?.xtream_credential_id) {
    const { rows: cr } = await db.execute({ sql: 'SELECT data FROM credentials WHERE id = ?', args: [cfg.xtream_credential_id] })
    if (cr.length) {
      const data = JSON.parse((cr[0] as any).data as string)
      server = data.server ?? ''; user = data.user ?? ''; pass = data.pass ?? ''; ext = data.ext ?? 'ts'
    }
  }
  if (!server) {
    server = cfg?.xtream_server ?? ''; user = cfg?.xtream_user ?? ''; pass = cfg?.xtream_pass ?? ''; ext = cfg?.xtream_ext ?? 'ts'
  }
  // Fallback : premier profil Xtream si rien sur le device
  if (!server) {
    const { rows } = await db.execute("SELECT data FROM credentials WHERE type = 'xtream' ORDER BY id LIMIT 1")
    if (rows.length) {
      const data = JSON.parse((rows[0] as any).data as string)
      server = data.server ?? ''; user = data.user ?? ''; pass = data.pass ?? ''; ext = data.ext ?? 'ts'
    }
  }
  // Sanitize : protège contre les espaces parasites dans les credentials saisis
  server = server.trim(); user = user.trim(); pass = pass.trim(); ext = ext.trim()
  if (!server || !user || !pass) return null
  const base = server.replace(/\/+$/, '')

  let url: string
  let container: string
  if (type === 'series') {
    // streamId = episode_id ; extension fournie par le frontend (get_series_info)
    const epExt = (explicitExt || 'mp4').replace(/^\./, '')
    url = `${base}/series/${user}/${pass}/${streamId}.${epExt}`
    container = epExt
  } else if (type === 'vod') {
    // Récupérer container_extension via get_vod_info — l'extension réelle varie (mkv/mp4/avi)
    let containerExt = explicitExt?.replace(/^\./, '') || 'mp4'
    if (!explicitExt) {
      try {
        const apiUrl = `${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&action=get_vod_info&vod_id=${streamId}`
        const r = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) } as any)
        if (r.ok) {
          const data: any = await r.json()
          containerExt = data?.movie_data?.container_extension || data?.info?.container_extension || 'mp4'
        }
      } catch (e) { console.warn('[iptv] get_vod_info failed:', (e as any).message) }
    }
    url = `${base}/movie/${user}/${pass}/${streamId}.${containerExt}`
    container = containerExt
  } else {
    url = `${base}/${user}/${pass}/${streamId}.${ext}`
    container = ext
  }

  // Résoudre la redirection 302 Xtream → URL directe du serveur de stream.
  // Beaucoup de players (notamment VLC sur certaines builds) bricolent quand
  // la redirection change d'host et de port (ex: tv.infinitrx.online → 103.176.90.96).
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(5000),
    } as any)
    const loc = r.headers.get('location')
    if (loc && (r.status === 301 || r.status === 302 || r.status === 303 || r.status === 307 || r.status === 308)) {
      console.log(`[iptv] resolved redirect → ${loc}`)
      return { url: loc, container }
    }
  } catch (e) { console.warn('[iptv] redirect resolve failed:', (e as any).message) }
  return { url, container }
}

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

async function plexRemotePlay(deviceIp: string, ratingKey: string, plexToken: string, plexServerUrl: string, machineId: string, offsetMs: number = 0): Promise<boolean> {
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
      offset: String(offsetMs),
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
  iptv_type: z.enum(['live', 'vod', 'series']).optional(),
  // nullable→undefined : les items de playlist envoient null pour les champs vides
  iptv_ext: z.string().nullable().optional().transform(v => v ?? undefined),  // container_extension (series episode)
  external_url: z.string().nullable().optional().transform(v => v ?? undefined),
  external_platform: z.string().nullable().optional().transform(v => v ?? undefined),
  // Spotify : ref_id de l'item = URI (spotify:playlist:… / spotify:album:… / spotify:track:…)
  spotify_uri: z.string().nullable().optional().transform(v => v ?? undefined),
  spotify_device_id: z.string().nullable().optional().transform(v => v ?? undefined),  // cible Connect (Echo/Shield…)
  title: z.string().nullable().optional().transform(v => v ?? undefined),
  thumb: z.string().nullable().optional().transform(v => v ?? undefined),
  resume: z.boolean().optional(),
  device_id: z.string().optional(),
  app: z.string().optional(),
  requester: z.enum(['zaparoo', 'llm', 'n8n', 'manual', 'ha']).default('manual')
})

// Récupère le viewOffset (ms) d'un media Plex via /library/metadata/{ratingKey}
async function getPlexViewOffset(ratingKey: string, serverUrl: string, token: string): Promise<number> {
  try {
    const r = await fetch(`${serverUrl}/library/metadata/${ratingKey}?X-Plex-Token=${token}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) as any,
    })
    if (!r.ok) return 0
    const data: any = await r.json()
    return Number(data?.MediaContainer?.Metadata?.[0]?.viewOffset ?? 0)
  } catch { return 0 }
}

// Construit l'URL absolue d'une image, accessible depuis le device (réseau LAN).
// req.headers.host est strip de son port quand le frontend nginx reverse-proxy
// /api/ vers le backend → on ajoute le port backend manuellement si manquant.
function getBackendBaseUrl(req: any): string {
  let host = (process.env.PUBLIC_URL || req.headers.host || 'localhost') as string
  if (!host.includes(':')) host = `${host}:${process.env.PORT || '8020'}`
  return `${req.protocol}://${host}`
}

function buildImageUrl(req: any, thumb: string | undefined, app: string): string | undefined {
  if (!thumb) return undefined
  const base = getBackendBaseUrl(req)
  if (/^https?:\/\//.test(thumb)) {
    // URL absolue (logo IPTV) → on passe par le proxy /api/iptv/image qui suit le mixed-content
    return `${base}/api/iptv/image?url=${encodeURIComponent(thumb)}`
  }
  if (thumb.startsWith('/') && app === 'plex') {
    return `${base}/api/plex/image?path=${encodeURIComponent(thumb)}`
  }
  return undefined
}

router.post('/', async (req, res) => {
  const parsed = PlaySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { query, catalog_id, ean, plex_id, iptv_stream_id, iptv_type, iptv_ext, external_url, external_platform, spotify_uri, spotify_device_id, title, thumb, resume, device_id, app, requester } = parsed.data
  const userId = (req as any).userId ?? null // profil courant (header X-User-Id)

  // 0. Spotify : flux à part — contrôle Spotify Connect via Web API, pas le catalogue
  //    ni l'agent WS. Le token « suit le profil actif » : on lit avec le compte du
  //    profil courant (ou le compte « Maison » si on cible une enceinte partagée).
  if (app === 'spotify' || spotify_uri) {
    if (!spotify_uri) return res.status(400).json({ error: 'spotify_uri requis' })
    // Le profil qui « possède » la lecture : header X-User-Id, ou Maison si demandé
    const playUserId = userId ?? MAISON_USER_ID
    const isTrack = spotify_uri.startsWith('spotify:track:')
    const body: any = isTrack ? { uris: [spotify_uri] } : { context_uri: spotify_uri }
    if (resume === false) body.position_ms = 0
    const dq = spotify_device_id ? `?device_id=${encodeURIComponent(spotify_device_id)}` : ''
    try {
      const r = await spotifyFetch(playUserId, `/me/player/play${dq}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok && r.status !== 204) {
        const detail = await r.text()
        return res.status(r.status).json({ error: 'spotify_play_failed', status: r.status, detail })
      }
    } catch (e: any) {
      // no_spotify_account : le profil actif n'a pas lié de compte
      return res.status(400).json({ error: e.message || 'spotify_error' })
    }
    await db.execute({
      sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [spotify_device_id ?? 'spotify', spotify_uri, 'spotify', title ?? 'Spotify', Date.now(), requester, userId],
    })
    return res.json({ ok: true, app: 'spotify', uri: spotify_uri, device_id: spotify_device_id ?? null, title: title ?? 'Spotify' })
  }

  // 1. Resolve catalog entry
  let entry: CatalogEntry | null = null

  if (external_url) {
    entry = {
      id: `ext:${external_platform ?? 'web'}:${Buffer.from(external_url).toString('base64').slice(0, 16)}`,
      title: title ?? 'External',
      type: 'movie',
    } as CatalogEntry
  } else if (plex_id) {
    entry = { id: `plex:${plex_id}`, title: title ?? 'Plex', type: 'movie', plex_id } as CatalogEntry
  } else if (iptv_stream_id) {
    entry = {
      id: `iptv:${iptv_type ?? 'live'}:${iptv_stream_id}`,
      title: title ?? 'IPTV',
      type: (iptv_type === 'vod' ? 'vod' : iptv_type === 'series' ? 'episode' : 'live_channel') as any,
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
      // Notif TvOverlay : préparation
      notifyOverlay(target_device_id, { title: 'Hub MediaCenter', message: `Préparation : ${entry.title}`, duration: 3 })
      const plexImageUrl = buildImageUrl(req, thumb, 'plex')

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

      const offsetMs = resume ? await getPlexViewOffset(entry.plex_id, plexCfg.server_url, plexCfg.auth_token) : 0
      if (resume && offsetMs > 0) console.log(`[plex] resume at ${offsetMs}ms (${Math.floor(offsetMs / 60000)}min)`)
      const ok = await plexRemotePlay(deviceIp, entry.plex_id, plexCfg.auth_token, plexCfg.server_url, plexCfg.server_machine_id, offsetMs)
      if (!ok) {
        notifyOverlay(target_device_id, { title: '✗ Échec Plex', message: 'Remote Control a échoué', duration: 5 })
        return res.status(502).json({ error: 'plex remote control failed' })
      }

      notifyOverlayPlayer(target_device_id, {
        title: entry.title,
        message: 'En lecture sur Plex',
        app_label: 'PLEX',
        image: plexImageUrl,
        image_kind: 'poster',
      })

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
        sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester, userId]
      })
      console.log(`[plex] remote control ok: ${entry.title} → ${target_device_id}`)
      return res.json({ ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app })
    }
    // Fallback : watch URL via agent si pas de config Plex
    const plex_watch_url = await resolvePlexWatchUrl(entry.plex_id) ?? undefined
    const cmd: WsPlayCommand = { type: 'play', catalog_id: entry.id, app: resolved_app, title: entry.title, plex_id: entry.plex_id, plex_watch_url, requester: requester as RequesterType }
    if (!sendPlayCommand(target_device_id, cmd)) return res.status(503).json({ error: 'failed to send command to device' })
    await db.execute({ sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester, userId] })
    return res.json({ ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app })
  }

  // 5. Autres apps : WebSocket vers l'agent
  const resolvedIptvType: 'live' | 'vod' | 'series' | undefined = iptv_type
    ?? (entry.type === 'vod' ? 'vod' : entry.type === 'episode' ? 'series' : entry.type === 'live_channel' ? 'live' : undefined)
  let streamUrl: string | undefined
  let iptvContainer: string | undefined
  if (resolved_app === 'iptv' && entry.tivimate_id && resolvedIptvType) {
    const built = await buildIptvStreamUrl(target_device_id, entry.tivimate_id, resolvedIptvType, iptv_ext)
    if (built) {
      streamUrl = built.url
      iptvContainer = built.container
      console.log(`[iptv] resolved ${resolvedIptvType} stream URL: ${built.url} (container=${built.container})`)
    } else {
      console.warn(`[iptv] failed to build stream URL for ${entry.tivimate_id} — agent will fallback`)
    }
  }

  // App externe (Netflix, Disney+, etc.) : on force app=external pour que l'agent
  // route vers le ExternalUrlLauncher (deep link Intent ACTION_VIEW).
  const finalApp: AppId = external_url ? 'external' : resolved_app

  // Lecteur IPTV préféré du device (auto/mxplayer/vlc/tivimate)
  let iptvPlayer: string | undefined
  if (resolved_app === 'iptv') {
    const { rows: pcfg } = await db.execute({ sql: 'SELECT iptv_player FROM device_config WHERE device_id = ?', args: [target_device_id] })
    iptvPlayer = ((pcfg[0] as any)?.iptv_player as string) || undefined
  }

  const cmd: WsPlayCommand = {
    type: 'play',
    catalog_id: entry.id,
    app: finalApp,
    title: entry.title,
    plex_id: entry.plex_id ?? undefined,
    tivimate_channel: entry.tivimate_id ?? undefined,
    iptv_type: resolvedIptvType,
    stream_url: streamUrl,
    iptv_container: iptvContainer,
    external_url: external_url ?? undefined,
    external_platform: external_platform ?? undefined,
    player: iptvPlayer,
    requester: requester as RequesterType
  }

  if (!sendPlayCommand(target_device_id, cmd)) {
    return res.status(503).json({ error: 'failed to send command to device' })
  }
  notifyOverlayPlayer(target_device_id, {
    title: entry.title,
    message: resolvedIptvType === 'live' ? 'Live en cours' : 'En lecture',
    app_label: (resolved_app as string).toUpperCase(),
    image: buildImageUrl(req, thumb, resolved_app as string),
    // Pour IPTV (logos chaînes) ratio carré → fitCenter ; VOD souvent posters → poster
    image_kind: resolved_app === 'iptv' && resolvedIptvType !== 'vod' ? 'logo' : 'poster',
  })

  await db.execute({
    sql: `UPDATE playback_state SET status='playing', catalog_id=?, title=?, app=?, started_at=? WHERE device_id=?`,
    args: [entry.id, entry.title, resolved_app, Date.now(), target_device_id]
  })

  await db.execute({
    sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester, userId]
  })

  res.json({ ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app })
})

export default router
