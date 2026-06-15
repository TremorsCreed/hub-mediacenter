import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage, Server } from 'http'
import { db } from './db'
import { WsMessage, WsPlayCommand, DeviceCapability } from './types'

interface ConnectedAgent {
  ws: WebSocket
  device_id: string
  isAlive: boolean
}

export const agents = new Map<string, ConnectedAgent>()

// Dernier état de lecture détaillé par device (barre « lecture en cours » du Hub).
// En mémoire : reflète l'instant, pas besoin de persister. position/duration en ms.
export interface MediaState {
  state: string            // 'playing' | 'paused' | 'stopped'
  app?: string
  title?: string
  position: number
  duration: number
  seekable: boolean
  package?: string
  art?: string             // URL http(s) de la pochette (MediaSession), si fournie
  volume?: number          // volume courant 0-100 (stream MUSIC du device)
  muted?: boolean
  updated_at: number       // pour extrapoler la position côté client
}
export const mediaStates = new Map<string, MediaState>()

// Anti-spam d'écritures DB de progression : on ne sauvegarde au plus qu'une fois
// toutes les PROGRESS_SAVE_MS par device (le tick agent arrive ~toutes les 2s).
const PROGRESS_SAVE_MS = 8000
const lastProgressSave = new Map<string, number>()

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', 'http://localhost')
    const device_id = url.searchParams.get('device_id')

    if (!device_id) { ws.close(1008, 'device_id required'); return }

    // Un agent qui se reconnecte (redémarrage, réinstall) remplace sa connexion
    // précédente : on termine l'ancienne socket explicitement pour ne pas garder
    // un zombie dans la map (vécu : overlay envoyé dans le vide, sent=true).
    const prev = agents.get(device_id)
    if (prev && prev.ws !== ws) {
      console.log(`[ws] ${device_id} reconnecte — terminaison de l'ancienne socket`)
      try { prev.ws.terminate() } catch { /* */ }
    }

    const agent: ConnectedAgent = { ws, device_id, isAlive: true }
    agents.set(device_id, agent)
    console.log(`[ws] agent connected: ${device_id}`)

    // Pong protocolaire (réponse au ws.ping() du heartbeat) = preuve de vie
    ws.on('pong', () => { agent.isAlive = true })

    ws.on('message', (raw) => {
      agent.isAlive = true // tout trafic applicatif vaut preuve de vie
      try {
        const msg: WsMessage = JSON.parse(raw.toString())
        handleAgentMessage(device_id, msg)
      } catch {
        console.error(`[ws] invalid message from ${device_id}`)
      }
    })

    ws.on('close', () => {
      // Ne retirer de la map que si c'est bien CETTE connexion qui y est encore
      // (une reconnexion a pu déjà la remplacer).
      if (agents.get(device_id)?.ws === ws) { agents.delete(device_id); mediaStates.delete(device_id); console.log(`[ws] disconnected: ${device_id}`) }
    })
    ws.on('error', () => { if (agents.get(device_id)?.ws === ws) agents.delete(device_id) })
    ws.send(JSON.stringify({ type: 'pong' }))
  })

  // Heartbeat : un agent qui n'a donné aucun signe de vie (ni pong protocolaire,
  // ni message) depuis le dernier passage est considéré mort → terminate, ce qui
  // déclenche 'close' et purge la map. Sans ça, un process tué sans FIN/RST reste
  // « connecté » indéfiniment et les commandes partent dans le vide.
  const heartbeat = setInterval(() => {
    for (const agent of agents.values()) {
      if (!agent.isAlive) {
        console.log(`[ws] ${agent.device_id} ne répond plus — terminaison (zombie)`)
        try { agent.ws.terminate() } catch { /* */ }
        continue
      }
      agent.isAlive = false
      try { agent.ws.ping() } catch { /* */ }
    }
  }, 30000)
  wss.on('close', () => clearInterval(heartbeat))

  return wss
}

async function handleAgentMessage(device_id: string, msg: WsMessage) {
  switch (msg.type) {
    case 'register': {
      const capabilities = (msg.capabilities as DeviceCapability[]) ?? []
      const incomingIp = (msg.ip as string) || ''
      const name = msg.name as string
      const platform = msg.platform as string

      // Dédup avec MERGE : un device qui se ré-enregistre après un uninstall/reinstall
      // obtient un nouveau device_id (UUID random dans SharedPreferences). On transfère
      // la config et l'historique de l'ancien vers le nouveau, puis on supprime l'ancien.
      // Critère de match : (name, platform) — même hardware logique. L'utilisateur peut
      // renommer un device pour éviter le merge si nécessaire.
      const { rows: dupes } = await db.execute({
        sql: 'SELECT id FROM devices WHERE name = ? AND platform = ? AND id != ?',
        args: [name, platform, device_id]
      })
      for (const r of dupes) {
        const oldId = (r as any).id as string
        console.log(`[ws] dedup: merging ${oldId} → ${device_id} (same name/platform)`)

        // Transférer la config seulement si le nouveau device n'en a pas encore.
        // ⚠ Inclure TOUS les champs ici sinon ils sont perdus au reinstall agent.
        await db.execute({
          sql: `INSERT OR IGNORE INTO device_config
                (device_id, xtream_server, xtream_user, xtream_pass, xtream_ext,
                 plex_server_id, app_mappings, xtream_credential_id,
                 tvoverlay_enabled, overlay_player_duration, updated_at)
                SELECT ?, xtream_server, xtream_user, xtream_pass, xtream_ext,
                       plex_server_id, app_mappings, xtream_credential_id,
                       tvoverlay_enabled, overlay_player_duration, updated_at
                FROM device_config WHERE device_id = ?`,
          args: [device_id, oldId]
        })
        // Réécrire l'historique sur le nouveau device_id pour garder une vue cohérente
        await db.execute({
          sql: 'UPDATE playback_history SET device_id = ? WHERE device_id = ?',
          args: [device_id, oldId]
        })
        // Cleanup de l'ancien
        await db.execute({ sql: 'DELETE FROM device_config WHERE device_id = ?', args: [oldId] })
        await db.execute({ sql: 'DELETE FROM playback_state WHERE device_id = ?', args: [oldId] })
        await db.execute({ sql: 'DELETE FROM devices WHERE id = ?', args: [oldId] })
      }

      // Ne PAS écraser l'IP avec une valeur vide — préserver la précédente.
      await db.execute({
        sql: `INSERT INTO devices (id, name, platform, ip, last_seen, capabilities)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, platform = excluded.platform,
                ip = COALESCE(NULLIF(excluded.ip, ''), devices.ip),
                last_seen = excluded.last_seen,
                capabilities = excluded.capabilities`,
        args: [device_id, name, platform, incomingIp || null, Date.now(), JSON.stringify(capabilities)]
      })
      // Reset à stopped : l'agent vient de se (re)connecter, aucune lecture n'est active.
      await db.execute({
        sql: `INSERT INTO playback_state (device_id, status) VALUES (?, 'stopped')
              ON CONFLICT(device_id) DO UPDATE SET status = 'stopped', catalog_id = NULL, title = NULL, app = NULL`,
        args: [device_id]
      })
      console.log(`[ws] registered: ${device_id} (${msg.name})${incomingIp ? ` ip=${incomingIp}` : ' (no ip, kept previous)'}`)

      // Push stored config to agent — résoudre xtream_credential_id, fallback sur le premier profil si rien
      const { rows } = await db.execute({ sql: 'SELECT * FROM device_config WHERE device_id = ?', args: [device_id] })
      const cfg = rows[0] as any | undefined
      let xtream = {
        xtream_server: cfg?.xtream_server ?? '',
        xtream_user: cfg?.xtream_user ?? '',
        xtream_pass: cfg?.xtream_pass ?? '',
        xtream_ext: cfg?.xtream_ext ?? 'ts',
      }
      let source = 'inline'
      if (cfg?.xtream_credential_id) {
        const { rows: cRows } = await db.execute({
          sql: 'SELECT data FROM credentials WHERE id = ? AND type = ?',
          args: [cfg.xtream_credential_id, 'xtream']
        })
        if (cRows.length) {
          const data = JSON.parse((cRows[0] as any).data as string)
          xtream = { xtream_server: data.server ?? '', xtream_user: data.user ?? '', xtream_pass: data.pass ?? '', xtream_ext: data.ext ?? 'ts' }
          source = `credential#${cfg.xtream_credential_id}`
        }
      }
      // Fallback : si aucune config Xtream, utiliser le premier profil disponible
      if (!xtream.xtream_server) {
        const { rows: anyCred } = await db.execute("SELECT id, data FROM credentials WHERE type = 'xtream' ORDER BY id LIMIT 1")
        if (anyCred.length) {
          const c = anyCred[0] as any
          const data = JSON.parse(c.data as string)
          if (data.server) {
            xtream = { xtream_server: data.server, xtream_user: data.user ?? '', xtream_pass: data.pass ?? '', xtream_ext: data.ext ?? 'ts' }
            source = `auto credential#${c.id}`
          }
        }
      }
      agents.get(device_id)?.ws.send(JSON.stringify({
        type: 'config',
        ...xtream,
        plex_server_id: cfg?.plex_server_id ?? '',
        app_mappings: cfg ? JSON.parse(cfg.app_mappings as string) : {}
      }))
      console.log(`[ws] config pushed: xtream=${xtream.xtream_server ? 'set' : 'empty'} (${source})`)
      break
    }
    case 'state_update': {
      // L'agent n'envoie pas le title dans ses state_update — utiliser COALESCE pour
      // préserver celui posé par /api/play (sinon le dashboard l'oublie après l'ack agent).
      await db.execute({
        sql: `UPDATE playback_state SET
                status = ?,
                catalog_id = COALESCE(?, catalog_id),
                app = COALESCE(?, app),
                title = COALESCE(?, title),
                started_at = ?
              WHERE device_id = ?`,
        args: [
          msg.status as string,
          (msg.catalog_id as string) || null,
          (msg.app as string) || null,
          (msg.title as string) || null,
          msg.status === 'playing' ? Date.now() : null,
          device_id,
        ]
      })
      break
    }
    case 'media': {
      // État de lecture temps réel poussé par l'agent à chaque tick (la position
      // avance). Stocké en mémoire, lu par la barre du Hub via /api/state/now.
      if (msg.state === 'stopped') {
        const prev = mediaStates.get(device_id)
        mediaStates.delete(device_id)
        lastProgressSave.delete(device_id)
        void maybeAutoplayNext(device_id, prev)
      } else {
        const art = (msg.art as string) || undefined
        const state: MediaState = {
          state: String(msg.state),
          app: (msg.app as string) || undefined,
          title: (msg.title as string) || undefined,
          position: Number(msg.position ?? 0),
          duration: Number(msg.duration ?? 0),
          seekable: !!msg.seekable,
          package: (msg.package as string) || undefined,
          art: art && /^https?:\/\//.test(art) ? art : undefined,
          volume: msg.volume != null ? Number(msg.volume) : undefined,
          muted: msg.muted != null ? !!msg.muted : undefined,
          updated_at: Date.now(),
        }
        mediaStates.set(device_id, state)
        void persistProgress(device_id, state)
      }
      break
    }
    case 'ping': {
      agents.get(device_id)?.ws.send(JSON.stringify({ type: 'pong' }))
      await db.execute({ sql: 'UPDATE devices SET last_seen = ? WHERE id = ?', args: [Date.now(), device_id] })
      break
    }
    case 'launchbox_reset_result': {
      console.log(`[launchbox] reset result from ${device_id}: killed=${msg.killed} relaunched=${msg.relaunched} — ${msg.detail}`)
      break
    }
  }
}

// Persiste l'avancement du média en cours (throttlé). On résout l'identité du média
// (catalog_id + champs de relecture déjà posés par /play) depuis playback_state, et on
// ne met à jour QUE la position/durée sur conflit — sans écraser plex_id/iptv_*/external_*
// (sinon une session détectée hors Hub effacerait les infos de relecture).
async function persistProgress(deviceId: string, m: MediaState): Promise<void> {
  if (!m.seekable || m.duration <= 0) return
  if (m.state !== 'playing' && m.state !== 'paused') return
  const now = Date.now()
  if (now - (lastProgressSave.get(deviceId) ?? 0) < PROGRESS_SAVE_MS) return
  lastProgressSave.set(deviceId, now)
  try {
    const { rows } = await db.execute({
      sql: 'SELECT catalog_id, title, app, thumb FROM playback_state WHERE device_id = ?',
      args: [deviceId],
    })
    const ps = rows[0] as any | undefined
    const catalogId = (ps?.catalog_id as string) || null
    const app = m.app || (ps?.app as string) || null
    const title = m.title || (ps?.title as string) || null
    const mediaKey = catalogId || (app && title ? `${app}|${title}` : null)
    if (!mediaKey) return
    const thumb = m.art || (ps?.thumb as string) || null
    await db.execute({
      sql: `INSERT INTO playback_progress
              (media_key, catalog_id, app, title, thumb, position, duration, seekable, device_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(media_key) DO UPDATE SET
              position = excluded.position,
              duration = excluded.duration,
              seekable = excluded.seekable,
              device_id = excluded.device_id,
              thumb = COALESCE(excluded.thumb, playback_progress.thumb),
              app = COALESCE(excluded.app, playback_progress.app),
              title = COALESCE(excluded.title, playback_progress.title),
              updated_at = excluded.updated_at`,
      args: [mediaKey, catalogId, app, title, thumb,
             Math.round(m.position), Math.round(m.duration), m.seekable ? 1 : 0, deviceId, now],
    })
  } catch { /* best-effort : la progression n'est pas critique */ }
}

// ── Autoplay « épisode suivant » ─────────────────────────────────────────────
// File d'attente des épisodes restants par device (poussée par le frontend au
// lancement d'un épisode de série) + compte à rebours en cours. Tout en mémoire :
// éphémère par nature (ne concerne qu'une session de visionnage active).
export interface UpNextItem {
  plex_id?: string
  iptv_stream_id?: string
  iptv_type?: string
  iptv_ext?: string
  title?: string
  thumb?: string
  duration_ms?: number   // durée attendue (utile quand le lecteur IPTV ne la rapporte pas)
}
interface UpNextState { items: UpNextItem[]; userId: number | null; expectedMs: number }
const upNext = new Map<string, UpNextState>()

interface PendingAutoplay { title: string; launchesAt: number; timer: ReturnType<typeof setTimeout>; next: UpNextItem; rest: UpNextItem[]; userId: number | null }
const pendingAutoplay = new Map<string, PendingAutoplay>()

const AUTOPLAY_COUNTDOWN_MS = 10000
const FINISH_RATIO = 0.90          // ≥90% lu = épisode considéré terminé
const FINISH_REMAIN_MS = 120000    // ou moins de 2 min restantes

// Lanceur injecté par play.ts (évite l'import circulaire ws ↔ play).
export type AutoplayLauncher = (deviceId: string, item: UpNextItem, rest: UpNextItem[], userId: number | null) => void
let autoplayLauncher: AutoplayLauncher | null = null
export function setAutoplayLauncher(fn: AutoplayLauncher) { autoplayLauncher = fn }

// Définit/écrase la file du device. Tout nouveau play annule un compte à rebours en cours.
// expectedMs = durée attendue de l'épisode COURANT (repli si la MediaSession ne donne
// pas de durée — fréquent avec les lecteurs IPTV).
export function setUpNext(deviceId: string, items: UpNextItem[] | undefined, userId: number | null, expectedMs = 0) {
  cancelAutoplay(deviceId)
  if (items && items.length) upNext.set(deviceId, { items, userId, expectedMs })
  else upNext.delete(deviceId)
}

export function cancelAutoplay(deviceId: string) {
  const p = pendingAutoplay.get(deviceId)
  if (p) { clearTimeout(p.timer); pendingAutoplay.delete(deviceId) }
}

export function getPendingAutoplay(deviceId: string): { title: string; launches_at: number } | null {
  const p = pendingAutoplay.get(deviceId)
  return p ? { title: p.title, launches_at: p.launchesAt } : null
}

// Lance immédiatement l'épisode en attente (bouton « Lancer » de la barre).
export function fireAutoplayNow(deviceId: string): boolean {
  const p = pendingAutoplay.get(deviceId)
  if (!p) return false
  clearTimeout(p.timer)
  pendingAutoplay.delete(deviceId)
  autoplayLauncher?.(deviceId, p.next, p.rest, p.userId)
  return true
}

// Déclenché quand une lecture s'arrête : si l'épisode était quasi terminé et qu'une
// file existe (autoplay activé pour le profil), arme le compte à rebours vers le suivant.
async function maybeAutoplayNext(deviceId: string, prev: MediaState | undefined): Promise<void> {
  if (!prev) return
  const q = upNext.get(deviceId)
  if (!q || !q.items.length) return
  // Durée de référence : celle de la MediaSession si dispo, sinon la durée attendue
  // transmise au lancement (les lecteurs IPTV ne rapportent souvent pas de durée).
  const effDuration = prev.duration > 0 ? prev.duration : q.expectedMs
  if (effDuration <= 0) return                       // impossible de juger « terminé » → on s'abstient
  const ratio = prev.position / effDuration
  const remaining = effDuration - prev.position
  if (ratio < FINISH_RATIO && remaining > FINISH_REMAIN_MS) return  // arrêt en cours de route → pas d'autoplay
  // Respect du réglage par profil (autoplay_next, défaut activé)
  if (q.userId != null) {
    try {
      const { rows } = await db.execute({ sql: 'SELECT autoplay_next FROM users WHERE id = ?', args: [q.userId] })
      if (rows.length && Number((rows[0] as any).autoplay_next) === 0) return
    } catch { /* en cas d'erreur DB, on autorise (défaut ON) */ }
  }
  const [next, ...rest] = q.items
  upNext.delete(deviceId) // consommé ; doPlay du suivant reposera la file (rest)
  const launchesAt = Date.now() + AUTOPLAY_COUNTDOWN_MS
  const timer = setTimeout(() => {
    pendingAutoplay.delete(deviceId)
    autoplayLauncher?.(deviceId, next, rest, q.userId)
  }, AUTOPLAY_COUNTDOWN_MS)
  pendingAutoplay.set(deviceId, { title: next.title ?? 'Épisode suivant', launchesAt, timer, next, rest, userId: q.userId })
  // Info sur la TV (sans bouton : l'annulation/le lancement se font depuis la barre du Hub)
  try { sendOverlay(deviceId, { title: 'À suivre', message: `${next.title ?? 'Épisode suivant'} — lecture dans 10 s`, duration: 11 }) } catch { /* */ }
}

export function sendPlayCommand(device_id: string, cmd: WsPlayCommand): boolean {
  const agent = agents.get(device_id)
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return false
  agent.ws.send(JSON.stringify(cmd))
  return true
}

export function sendNotify(device_id: string, text: string): boolean {
  const agent = agents.get(device_id)
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return false
  agent.ws.send(JSON.stringify({ type: 'notify', text }))
  return true
}

export function sendControl(device_id: string, action: string, extra?: Record<string, unknown>): boolean {
  const agent = agents.get(device_id)
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return false
  agent.ws.send(JSON.stringify({ type: 'control', action, ...extra }))
  return true
}

export function sendOverlay(device_id: string, payload: {
  title?: string
  message: string
  duration?: number
  style?: 'small' | 'player'
  image?: string       // URL absolue (chargée par l'agent)
  image_kind?: 'poster' | 'logo'  // poster=centerCrop 2:3, logo=fitCenter carré
  app_label?: string   // label en haut de la card player (ex "PLEX", "IPTV")
  action?: 'hide'      // si fourni, retire l'overlay au lieu d'afficher
  interactive?: boolean // rappel EPG : carte avec bouton « Regarder » focusable
  stream_id?: string    // chaîne à lancer au clic du bouton
  iptv_type?: string    // 'live' par défaut côté agent
}): boolean {
  const agent = agents.get(device_id)
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return false
  agent.ws.send(JSON.stringify({ type: 'overlay', ...payload }))
  return true
}

export function isConnected(device_id: string): boolean {
  const a = agents.get(device_id)
  return !!a && a.ws.readyState === WebSocket.OPEN
}

export function getConnectedIds(): string[] {
  return [...agents.keys()]
}
