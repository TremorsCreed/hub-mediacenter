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
      // Ne PAS écraser l'IP avec une valeur vide — préserver la précédente.
      // (l'app Android pré-fix ConnectivityManager renvoie null sur Android 12+/Shield TV)
      await db.execute({
        sql: `INSERT INTO devices (id, name, platform, ip, last_seen, capabilities)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, platform = excluded.platform,
                ip = COALESCE(NULLIF(excluded.ip, ''), devices.ip),
                last_seen = excluded.last_seen,
                capabilities = excluded.capabilities`,
        args: [device_id, msg.name as string, msg.platform as string, incomingIp || null, Date.now(), JSON.stringify(capabilities)]
      })
      await db.execute({
        sql: `INSERT INTO playback_state (device_id, status) VALUES (?, 'stopped') ON CONFLICT(device_id) DO NOTHING`,
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
      await db.execute({
        sql: `UPDATE playback_state SET status = ?, catalog_id = ?, app = ?, started_at = ? WHERE device_id = ?`,
        args: [msg.status as string, (msg.catalog_id as string) ?? null, (msg.app as string) ?? null, msg.status === 'playing' ? Date.now() : null, device_id]
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

export function isConnected(device_id: string): boolean {
  const a = agents.get(device_id)
  return !!a && a.ws.readyState === WebSocket.OPEN
}

export function getConnectedIds(): string[] {
  return [...agents.keys()]
}
