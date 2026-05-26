import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage, Server } from 'http'
import { db } from './db'
import { WsMessage, WsPlayCommand, DeviceCapability } from './types'

interface ConnectedAgent {
  ws: WebSocket
  device_id: string
}

const agents = new Map<string, ConnectedAgent>()

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
      await db.execute({
        sql: `INSERT INTO devices (id, name, platform, ip, last_seen, capabilities)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, platform = excluded.platform,
                ip = excluded.ip, last_seen = excluded.last_seen,
                capabilities = excluded.capabilities`,
        args: [device_id, msg.name as string, msg.platform as string, (msg.ip as string) ?? null, Date.now(), JSON.stringify(capabilities)]
      })
      await db.execute({
        sql: `INSERT INTO playback_state (device_id, status) VALUES (?, 'stopped') ON CONFLICT(device_id) DO NOTHING`,
        args: [device_id]
      })
      console.log(`[ws] registered: ${device_id} (${msg.name})`)
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

export function isConnected(device_id: string): boolean {
  const a = agents.get(device_id)
  return !!a && a.ws.readyState === WebSocket.OPEN
}

export function getConnectedIds(): string[] {
  return [...agents.keys()]
}
