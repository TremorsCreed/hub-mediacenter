// Client WebSocket — connexion au Hub avec reconnect exponential backoff.
// Mêmes patterns que l'agent Android (register, state_update, ping/pong, config push).

import WebSocket from 'ws'
import { config, save } from './config.js'
import { platformLabel } from './config.js'
import { localIp } from './ip.js'
import { handlePlay } from './handler.js'
import { notify } from './notify.js'
import { resetLaunchBox } from './launchers/launchbox.js'
import type { DeviceCapability, WsMessage, WsPlayCommand } from './types.js'

const CAPABILITIES: DeviceCapability[] = [
  // Plex via Plex Desktop ou web app — le hub backend gère Remote Control HTTP
  { app: 'plex',      can_receive: ['movie', 'episode', 'music'], launch_method: 'plex_desktop_or_web' },
  // IPTV via VLC (stream_url pré-construite par le hub)
  { app: 'iptv',      can_receive: ['live_channel', 'vod'],       launch_method: 'vlc' },
  // Netflix / Disney+ / Prime / etc. → deep link navigateur
  { app: 'external',  can_receive: ['movie', 'episode'],          launch_method: 'browser' },
  // Reset LaunchBox (taskkill + relance) — débloque MarquesasServer
  { app: 'launchbox', can_receive: ['reset'],                     launch_method: 'taskkill_relaunch' },
]

let ws: WebSocket | null = null
let reconnectAttempts = 0
const MAX_RECONNECT_DELAY = 60_000

export function start() {
  connect()
}

function buildWsUrl(): string {
  const base = config.hub_url.trim().replace(/\/+$/, '')
  return `${base}/ws?device_id=${config.device_id}`
}

function connect() {
  const url = buildWsUrl()
  console.log(`[ws] connecting to ${url}`)
  ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 8000 })

  ws.on('open', () => {
    console.log('[ws] connected')
    reconnectAttempts = 0
    notify('Hub MediaCenter', 'Agent connecté')
    ws?.send(JSON.stringify({
      type: 'register',
      device_id: config.device_id,
      name: config.device_name,
      platform: platformLabel(),
      ip: localIp(config.hub_url) ?? null,
      capabilities: CAPABILITIES,
    }))
  })

  ws.on('message', (raw) => {
    let msg: WsMessage
    try { msg = JSON.parse(raw.toString()) } catch { console.warn('[ws] bad json'); return }
    handleMessage(msg)
  })

  ws.on('close', (code) => {
    console.log(`[ws] closed (${code})`)
    if (code !== 1000) scheduleReconnect()
  })

  ws.on('error', (err) => {
    console.warn('[ws] error:', err.message)
    // 'close' suivra et déclenchera le reconnect
  })

  // Heartbeat applicatif toutes les 30s — keep-alive + update last_seen côté hub
  const hb = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    else clearInterval(hb)
  }, 30_000)
}

function scheduleReconnect() {
  reconnectAttempts++
  const delay = Math.min(1000 * reconnectAttempts * reconnectAttempts, MAX_RECONNECT_DELAY)
  console.log(`[ws] reconnect in ${delay / 1000}s`)
  setTimeout(connect, delay)
}

function handleMessage(msg: WsMessage) {
  switch (msg.type) {
    case 'play':
      handlePlay({
        cmd: msg as WsPlayCommand,
        onState: (status, extra) => sendState(status, (msg as WsPlayCommand).catalog_id, extra?.app),
      })
      break
    case 'stop':
      notify('Hub MediaCenter', 'Lecture arrêtée')
      sendState('stopped')
      break
    case 'notify': {
      const text = (msg.text as string) ?? ''
      if (text) notify('Hub MediaCenter', text)
      break
    }
    case 'overlay': {
      // Pas d'overlay graphique sur PC : on remappe vers une notif système
      const title = (msg.title as string) ?? 'Hub MediaCenter'
      const message = (msg.message as string) ?? ''
      if (msg.action !== 'hide' && message) notify(title, message)
      break
    }
    case 'config': {
      // Le hub pousse les credentials Xtream + plex_server_id au register.
      // On les stocke mais on ne s'en sert pas directement (le hub résout
      // les stream URLs avant de nous les envoyer).
      const updated = {
        ...config,
        xtream: {
          server: (msg.xtream_server as string) ?? '',
          user: (msg.xtream_user as string) ?? '',
          pass: (msg.xtream_pass as string) ?? '',
          ext: (msg.xtream_ext as string) ?? 'ts',
        },
        plex_server_id: (msg.plex_server_id as string) ?? '',
      }
      Object.assign(config, updated)
      save(config)
      console.log('[ws] config updated')
      break
    }
    case 'launchbox_reset': {
      // Le hub nous demande de débloquer MarquesasServer en tuant LaunchBox.
      const relaunch = msg.relaunch !== false
      console.log(`[launchbox] reset request (relaunch=${relaunch})`)
      notify('Hub MediaCenter', `Reset LaunchBox${relaunch ? ' + relance' : ''}…`)
      resetLaunchBox({ relaunch })
        .then(r => {
          console.log(`[launchbox] reset done: ${r.detail}`)
          notify('LaunchBox', r.detail)
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'launchbox_reset_result',
              ok: r.ok, killed: r.killed, relaunched: r.relaunched, detail: r.detail,
              request_id: (msg.request_id as string) ?? null,
            }))
          }
        })
        .catch(e => console.error('[launchbox] reset error:', e))
      break
    }
    case 'control': {
      // Les KEYCODE_MEDIA_* d'Android n'ont pas d'équivalent direct sur PC sans
      // nut.js. Pour l'instant on log juste — on pourra implémenter via robotjs
      // ou raccourcis OS plus tard si besoin.
      console.log(`[control] ${msg.action} — not implemented on PC yet`)
      break
    }
    case 'pong':
      break
    default:
      console.warn('[ws] unknown msg:', msg.type)
  }
}

function sendState(status: 'playing' | 'paused' | 'stopped' | 'error', catalog_id?: string, app?: string) {
  if (ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'state_update', status, catalog_id, app }))
}
