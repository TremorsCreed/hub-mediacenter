import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { sendPlayCommand, sendNotify, isConnected, getConnectedIds, sendControl, mediaStates,
  setUpNext, cancelAutoplay, fireAutoplayNow, setAutoplayLauncher, UpNextItem } from '../ws'
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

  // On NE pré-résout PAS la redirection 302 : le token de la redirection Xtream est
  // à usage unique / expirant. Si le Hub le consomme en le résolvant, le lecteur
  // reçoit un token déjà mort → HTTP 400 "no access modules matched" (cas Armageddon).
  // On passe l'URL d'origine (avec la bonne extension) ; le lecteur suit le 302 et
  // obtient son propre token frais. VLC/MX Player gèrent très bien la redirection.
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
    // continuous=1 : Plex enchaîne nativement les épisodes suivants de la série (son
    // propre « À suivre »). Plus fiable que toute détection côté Hub. La file upNext
    // du Hub reste en place comme filet : entre deux épisodes en mode continu il n'y a
    // PAS d'arrêt → le Hub ne déclenche pas ; il ne prend le relais que si le client
    // Plex a l'autoplay désactivé (auquel cas un vrai 'stopped' survient).
    const queueParams = new URLSearchParams({
      type: 'video',
      uri,
      continuous: '1',
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

// Dernier host/protocole vus sur une vraie requête /play — réutilisés pour l'autoplay
// (qui relance sans requête HTTP) afin que les URLs d'images d'overlay soient joignables.
let lastHost = process.env.PUBLIC_URL || `localhost:${process.env.PORT || '8020'}`
let lastProto = 'http'

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
  // Position de départ (ms) — transfert « continuer sur… » / reprise explicite.
  resume_position_ms: z.number().nullable().optional().transform(v => v ?? undefined),
  // File d'attente des épisodes SUIVANTS (autoplay) — ordonnée, sans l'épisode courant.
  up_next: z.array(z.object({
    plex_id: z.string().optional(),
    iptv_stream_id: z.string().optional(),
    iptv_type: z.string().optional(),
    iptv_ext: z.string().optional(),
    title: z.string().optional(),
    thumb: z.string().optional(),
    duration_ms: z.number().optional(),
  })).nullable().optional().transform(v => v ?? undefined),
  // Durée attendue de l'épisode courant (repli détection fin si le lecteur ne la donne pas).
  series_duration_ms: z.number().nullable().optional().transform(v => v ?? undefined),
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
  // Idempotence : un thumb déjà proxifié (persisté dans playback_state/playback_progress,
  // réutilisé lors d'un transfert) ne doit pas être re-proxifié en boucle.
  if (thumb.includes('/api/iptv/image') || thumb.includes('/api/plex/image')) return thumb
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

// Enregistre, au lancement, tout ce qu'il faut pour reprendre/transférer ce média
// (champs de relecture). media_key = catalog_id synthétique (= ce que le tick WS
// recalcule depuis playback_state, d'où l'alignement des clés). position = offset de
// reprise (0 = relecture du début, ce qui remet le compteur à zéro volontairement).
async function upsertProgressOnLaunch(mediaKey: string, f: {
  catalogId: string; app: string; title: string; thumb: string | null
  plexId?: string | null; iptvStreamId?: string | null; iptvType?: string | null; iptvExt?: string | null
  externalUrl?: string | null; externalPlatform?: string | null
  position: number; seekable: boolean; deviceId: string; userId: number | null
}): Promise<void> {
  try {
    await db.execute({
      sql: `INSERT INTO playback_progress
              (media_key, catalog_id, app, title, thumb, plex_id, iptv_stream_id, iptv_type, iptv_ext,
               external_url, external_platform, position, duration, seekable, device_id, user_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
            ON CONFLICT(media_key) DO UPDATE SET
              catalog_id = excluded.catalog_id, app = excluded.app, title = excluded.title,
              thumb = COALESCE(excluded.thumb, playback_progress.thumb),
              plex_id = excluded.plex_id, iptv_stream_id = excluded.iptv_stream_id,
              iptv_type = excluded.iptv_type, iptv_ext = excluded.iptv_ext,
              external_url = excluded.external_url, external_platform = excluded.external_platform,
              position = excluded.position, seekable = excluded.seekable,
              device_id = excluded.device_id,
              user_id = COALESCE(excluded.user_id, playback_progress.user_id),
              updated_at = excluded.updated_at`,
      args: [mediaKey, f.catalogId, f.app, f.title, f.thumb,
             f.plexId ?? null, f.iptvStreamId ?? null, f.iptvType ?? null, f.iptvExt ?? null,
             f.externalUrl ?? null, f.externalPlatform ?? null,
             Math.max(0, Math.round(f.position)), f.seekable ? 1 : 0, f.deviceId, f.userId, Date.now()],
    })
  } catch { /* best-effort */ }
}

type PlayResult = { status: number; body: any }

// Cœur du lancement, réutilisable : appelé par POST /play (requête utilisateur) et par
// POST /play/transfer (« continuer sur… »). Retourne { status, body } au lieu d'écrire
// la réponse, pour que les deux routes décident du code HTTP.
async function doPlay(input: z.infer<typeof PlaySchema>, userId: number | null, req: any): Promise<PlayResult> {
  const { query, catalog_id, ean, plex_id, iptv_stream_id, iptv_type, iptv_ext, external_url, external_platform, spotify_uri, spotify_device_id, title, thumb, resume, resume_position_ms, up_next, series_duration_ms, device_id, app, requester } = input

  // 0. Spotify : flux à part — contrôle Spotify Connect via Web API, pas le catalogue
  //    ni l'agent WS. Le token « suit le profil actif » : on lit avec le compte du
  //    profil courant (ou le compte « Maison » si on cible une enceinte partagée).
  if (app === 'spotify' || spotify_uri) {
    if (!spotify_uri) return { status: 400, body: { error: 'spotify_uri requis' } }
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
        return { status: r.status, body: { error: 'spotify_play_failed', status: r.status, detail } }
      }
    } catch (e: any) {
      // no_spotify_account : le profil actif n'a pas lié de compte
      return { status: 400, body: { error: e.message || 'spotify_error' } }
    }
    await db.execute({
      sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [spotify_device_id ?? 'spotify', spotify_uri, 'spotify', title ?? 'Spotify', Date.now(), requester, userId],
    })
    return { status: 200, body: { ok: true, app: 'spotify', uri: spotify_uri, device_id: spotify_device_id ?? null, title: title ?? 'Spotify' } }
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

  if (!entry) return { status: 404, body: { error: 'media not found', query, ean, catalog_id } }

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

  if (!target_device_id) return { status: 503, body: { error: 'no device available for this media type' } }
  if (!isConnected(target_device_id)) return { status: 503, body: { error: 'device not connected', device_id: target_device_id } }

  // File d'attente autoplay : ce play (épisode courant) définit la suite. Un play sans
  // up_next efface toute file/compte à rebours en cours pour ce device.
  setUpNext(target_device_id, up_next as UpNextItem[] | undefined, userId, series_duration_ms ?? 0)

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
        return { status: 503, body: {
          error: 'Plex injoignable sur le device. Ferme l\'app en cours sur le Shield (YouTube/autre) et réessaie.',
          hint: 'android_foreground_blocked',
        } }
      }

      // Position de départ : explicite (transfert « continuer sur… ») prioritaire,
      // sinon le viewOffset enregistré côté serveur Plex si resume demandé.
      const offsetMs = resume_position_ms != null ? Math.max(0, Math.round(resume_position_ms))
        : (resume ? await getPlexViewOffset(entry.plex_id, plexCfg.server_url, plexCfg.auth_token) : 0)
      if (offsetMs > 0) console.log(`[plex] start at ${offsetMs}ms (${Math.floor(offsetMs / 60000)}min)`)
      const ok = await plexRemotePlay(deviceIp, entry.plex_id, plexCfg.auth_token, plexCfg.server_url, plexCfg.server_machine_id, offsetMs)
      if (!ok) {
        notifyOverlay(target_device_id, { title: '✗ Échec Plex', message: 'Remote Control a échoué', duration: 5 })
        return { status: 502, body: { error: 'plex remote control failed' } }
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
        sql: `UPDATE playback_state SET status='playing', catalog_id=?, title=?, app='plex', thumb=?, started_at=? WHERE device_id=?`,
        args: [entry.id, entry.title, plexImageUrl ?? null, Date.now(), target_device_id]
      })
      // Socle « continuer sur… » : on enregistre de quoi reprendre/transférer ce média.
      await upsertProgressOnLaunch(entry.id, {
        catalogId: entry.id, app: 'plex', title: entry.title, thumb: plexImageUrl ?? null,
        plexId: entry.plex_id, position: offsetMs, seekable: true, deviceId: target_device_id, userId,
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
      return { status: 200, body: { ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app } }
    }
    // Fallback : watch URL via agent si pas de config Plex
    const plex_watch_url = await resolvePlexWatchUrl(entry.plex_id) ?? undefined
    const cmd: WsPlayCommand = { type: 'play', catalog_id: entry.id, app: resolved_app, title: entry.title, plex_id: entry.plex_id, plex_watch_url, requester: requester as RequesterType }
    if (!sendPlayCommand(target_device_id, cmd)) return { status: 503, body: { error: 'failed to send command to device' } }
    await db.execute({ sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester, userId] })
    return { status: 200, body: { ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app } }
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

  // Lecteur IPTV : réglage du device (auto/justplayer/mxplayer/vlc/tivimate),
  // surchargé par le lecteur par défaut du profil courant s'il en a un.
  let iptvPlayer: string | undefined
  if (resolved_app === 'iptv') {
    const { rows: pcfg } = await db.execute({ sql: 'SELECT iptv_player FROM device_config WHERE device_id = ?', args: [target_device_id] })
    iptvPlayer = ((pcfg[0] as any)?.iptv_player as string) || undefined
    if (userId != null) {
      const { rows: urows } = await db.execute({ sql: 'SELECT default_player FROM users WHERE id = ?', args: [userId] })
      const userPlayer = ((urows[0] as any)?.default_player as string) || undefined
      if (userPlayer) iptvPlayer = userPlayer
    }
  }

  // Position de départ (transfert/reprise) : seulement pour les flux seekable (pas le
  // live, et les deep links externes reprennent via leur propre compte → ignoré).
  const startMs = (resume_position_ms != null && finalApp !== 'external' && resolvedIptvType !== 'live')
    ? Math.max(0, Math.round(resume_position_ms)) : 0

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
    resume_ms: startMs > 0 ? startMs : undefined,
    requester: requester as RequesterType
  }

  if (!sendPlayCommand(target_device_id, cmd)) {
    return { status: 503, body: { error: 'failed to send command to device' } }
  }
  const thumbUrl = buildImageUrl(req, thumb, resolved_app as string)
  notifyOverlayPlayer(target_device_id, {
    title: entry.title,
    message: resolvedIptvType === 'live' ? 'Live en cours' : 'En lecture',
    app_label: (resolved_app as string).toUpperCase(),
    image: thumbUrl,
    // Pour IPTV (logos chaînes) ratio carré → fitCenter ; VOD souvent posters → poster
    image_kind: resolved_app === 'iptv' && resolvedIptvType !== 'vod' ? 'logo' : 'poster',
  })

  await db.execute({
    sql: `UPDATE playback_state SET status='playing', catalog_id=?, title=?, app=?, thumb=?, started_at=? WHERE device_id=?`,
    args: [entry.id, entry.title, resolved_app, thumbUrl ?? null, Date.now(), target_device_id]
  })

  // Socle « continuer sur… ». Le live n'est pas suivi (rien à reprendre).
  if (resolvedIptvType !== 'live') {
    await upsertProgressOnLaunch(entry.id, {
      catalogId: entry.id, app: finalApp, title: entry.title, thumb: thumbUrl ?? null,
      plexId: entry.plex_id ?? null,
      iptvStreamId: entry.tivimate_id ?? null, iptvType: resolvedIptvType ?? null, iptvExt: iptv_ext ?? null,
      externalUrl: external_url ?? null, externalPlatform: external_platform ?? null,
      position: startMs, seekable: finalApp !== 'external', deviceId: target_device_id, userId,
    })
  }

  await db.execute({
    sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [target_device_id, entry.id, resolved_app, entry.title, Date.now(), requester, userId]
  })

  return { status: 200, body: { ok: true, device_id: target_device_id, catalog_id: entry.id, title: entry.title, app: resolved_app } }
}

// POST /play — requête utilisateur classique.
router.post('/', async (req, res) => {
  const parsed = PlaySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const userId = (req as any).userId ?? null // profil courant (header X-User-Id)
  // Mémorise un req « réaliste » (host LAN) pour l'autoplay, qui n'a pas de requête HTTP.
  lastProto = req.protocol || 'http'
  lastHost = (req.headers?.host as string) || lastHost
  const r = await doPlay(parsed.data, userId, req)
  res.status(r.status).json(r.body)
})

// POST /play/cancel-next/:deviceId — annule le compte à rebours autoplay en cours.
router.post('/cancel-next/:deviceId', (req, res) => {
  cancelAutoplay(req.params.deviceId)
  res.json({ ok: true })
})

// POST /play/play-next-now/:deviceId — lance immédiatement l'épisode en attente.
router.post('/play-next-now/:deviceId', (req, res) => {
  const ok = fireAutoplayNow(req.params.deviceId)
  res.json({ ok })
})

// Autoplay : enregistre le lanceur (relance le suivant via doPlay, en propageant le
// reste de la file). Pas de requête HTTP ici → on fabrique un req synthétique avec le
// dernier host LAN connu (pour que les images d'overlay restent joignables par la TV).
setAutoplayLauncher((deviceId, item, rest, userId) => {
  const fakeReq = { protocol: lastProto, headers: { host: lastHost } }
  const input = PlaySchema.parse({
    device_id: deviceId,
    app: item.plex_id ? 'plex' : 'iptv',
    plex_id: item.plex_id,
    iptv_stream_id: item.iptv_stream_id,
    iptv_type: item.iptv_type ?? (item.iptv_stream_id ? 'series' : undefined),
    iptv_ext: item.iptv_ext,
    title: item.title,
    thumb: item.thumb,
    up_next: rest,
    series_duration_ms: item.duration_ms,
    requester: 'manual',
  })
  doPlay(input, userId, fakeReq)
    .then(r => { if (r.status >= 400) console.warn('[autoplay] launch failed:', r.body?.error) })
    .catch(e => console.error('[autoplay] launch error:', e))
})

const TransferSchema = z.object({
  from_device_id: z.string(),
  to_device_id: z.string(),
  player: z.string().nullable().optional().transform(v => v ?? undefined),
})

// POST /play/transfer — « continuer la lecture sur… » : enregistre la position courante,
// arrête le device source, relance le même média sur la cible à la même position.
// Ne marche que pour les médias relançables par le Hub (Plex, IPTV VOD/séries) ; le
// live et les apps externes (Netflix/Disney+) ne sont pas transférables avec reprise.
router.post('/transfer', async (req, res) => {
  const parsed = TransferSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { from_device_id, to_device_id, player } = parsed.data
  const userId = (req as any).userId ?? null

  // Identité du média en cours sur la source
  const { rows: psRows } = await db.execute({
    sql: 'SELECT catalog_id, app, title FROM playback_state WHERE device_id = ?', args: [from_device_id],
  })
  const ps = psRows[0] as any | undefined
  const mediaKey = ps?.catalog_id || (ps?.app && ps?.title ? `${ps.app}|${ps.title}` : null)
  if (!mediaKey) return res.status(404).json({ error: 'rien à transférer sur ce device' })

  const { rows: prRows } = await db.execute({ sql: 'SELECT * FROM playback_progress WHERE media_key = ?', args: [mediaKey] })
  const pr = prRows[0] as any | undefined
  if (!pr || (!pr.plex_id && !pr.iptv_stream_id && !pr.external_url)) {
    return res.status(422).json({ error: 'media_not_transferable', message: 'Ce média a été lancé hors du Hub : impossible de le relancer ailleurs.' })
  }

  // Position live (plus fraîche que la DB throttlée) — extrapolée si en lecture.
  const live = mediaStates.get(from_device_id)
  let pos = Number(pr.position) || 0
  if (live && live.duration > 0) {
    pos = live.state === 'playing' ? live.position + (Date.now() - live.updated_at) : live.position
    pos = Math.max(0, Math.min(pos, live.duration))
  }
  const isLive = pr.iptv_type === 'live'

  // Stop sur la source avant de relancer ailleurs
  if (isConnected(from_device_id)) sendControl(from_device_id, 'stop')

  const input = PlaySchema.parse({
    device_id: to_device_id,
    app: pr.app || undefined,
    plex_id: pr.plex_id || undefined,
    iptv_stream_id: pr.iptv_stream_id || undefined,
    iptv_type: pr.iptv_type || undefined,
    iptv_ext: pr.iptv_ext || undefined,
    external_url: pr.external_url || undefined,
    external_platform: pr.external_platform || undefined,
    title: pr.title || undefined,
    thumb: pr.thumb || undefined,
    resume_position_ms: isLive ? undefined : pos,
    requester: 'manual',
  })
  const r = await doPlay(input, userId, req)
  res.status(r.status).json({ ...r.body, transferred_position_ms: isLive ? null : pos })
})

export default router
