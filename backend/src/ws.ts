import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage, Server } from 'http'
import { db } from './db'
import { WsMessage, WsPlayCommand, DeviceCapability } from './types'

interface ConnectedAgent {
  ws: WebSocket
  device_id: string
}

export const agents = new Map<string, ConnectedAgent>()

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', 'http://localhost')
    const device_id = url.searchParams.get('device_id')

    if (!device_id) { ws.close(1008, 'device_id required'); return }

    agents.set(device_id, { ws, device_id })
    console.log(`[ws] agent connected: ${device_id}`)

    ws.on('message', (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString())
        handleAgentMessage(device_id, msg)
      } catch {
        console.error(`[ws] invalid message from ${device_id}`)
      }
    })

    ws.on('close', () => { agents.delete(device_id); console.log(`[ws] disconnected: ${device_id}`) })
    ws.on('error', () => agents.delete(device_id))
    ws.send(JSON.stringify({ type: 'pong' }))
  })

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
    case 'ping': {
      agents.get(device_id)?.ws.send(JSON.stringify({ type: 'pong' }))
      await db.execute({ sql: 'UPDATE devices SET last_seen = ? WHERE id = ?', args: [Date.now(), device_id] })
      break
    }
  }
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

export function sendControl(device_id: string, action: string): boolean {
  const agent = agents.get(device_id)
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return false
  agent.ws.send(JSON.stringify({ type: 'control', action }))
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
