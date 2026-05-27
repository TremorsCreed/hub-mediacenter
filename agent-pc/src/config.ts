// Config locale persistée dans config.json à côté du binaire.
// On y stocke le device_id (UUID stable entre redémarrages), le hub URL,
// le nom du device et les credentials Xtream poussés par le hub.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hostname, platform } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface AgentConfig {
  device_id: string
  device_name: string
  hub_url: string
  xtream?: {
    server: string
    user: string
    pass: string
    ext: string
  }
  plex_server_id?: string
}

const CONFIG_FILE = process.env.HUB_AGENT_CONFIG || join(process.cwd(), 'config.json')

function loadOrInit(): AgentConfig {
  if (existsSync(CONFIG_FILE)) {
    try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) } catch {}
  }
  const fresh: AgentConfig = {
    device_id: randomUUID().replace(/-/g, '').slice(0, 16),
    device_name: process.env.HUB_AGENT_NAME || hostname(),
    hub_url: process.env.HUB_AGENT_URL || 'ws://192.168.1.15:8020',
  }
  save(fresh)
  return fresh
}

export function save(cfg: AgentConfig) {
  const dir = dirname(CONFIG_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

export function platformLabel(): string {
  // Reporté au hub dans le register (champ "platform")
  switch (platform()) {
    case 'win32': return 'pc_windows'
    case 'darwin': return 'pc_macos'
    case 'linux': return 'pc_linux'
    default: return 'pc_other'
  }
}

export const config = loadOrInit()
