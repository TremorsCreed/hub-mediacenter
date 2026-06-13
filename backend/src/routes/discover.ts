import { Router } from 'express'
import net from 'node:net'
import { db } from '../db'
import { requireAdmin } from '../auth'

const router = Router()

// Teste si un port TCP est ouvert (un device ADB-over-TCP écoute sur 5555).
function probe(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = new net.Socket()
    let settled = false
    const done = (ok: boolean) => { if (!settled) { settled = true; sock.destroy(); resolve(ok) } }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
    sock.connect(port, ip)
  })
}

// Scan concurrent d'une liste d'IP sur un port donné.
async function scan(ips: string[], port: number, concurrency = 48, timeoutMs = 500): Promise<string[]> {
  const open: string[] = []
  let i = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < ips.length) {
      const ip = ips[i++]
      if (await probe(ip, port, timeoutMs)) open.push(ip)
    }
  }))
  return open.sort((a, b) => Number(a.split('.')[3]) - Number(b.split('.')[3]))
}

// Déduit le /24 à scanner depuis les devices déjà connus, sinon 192.168.1.
async function deduceSubnet(): Promise<string> {
  try {
    const { rows } = await db.execute("SELECT ip FROM devices WHERE ip IS NOT NULL AND ip != ''")
    const counts = new Map<string, number>()
    for (const r of rows as any[]) {
      const m = String(r.ip).match(/^(\d+\.\d+\.\d+)\.\d+$/)
      if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
    }
    let best = '192.168.1', max = 0
    for (const [sub, n] of counts) if (n > max) { max = n; best = sub }
    return best
  } catch { return '192.168.1' }
}

// GET /api/discover[?subnet=192.168.1] — scanne le /24 sur le port ADB (5555) et
// croise avec les agents enregistrés (agent déjà installé vs nouveau lecteur).
router.get('/', requireAdmin, async (req, res) => {
  const subnetRaw = (req.query.subnet as string) || ''
  const subnet = /^\d+\.\d+\.\d+$/.test(subnetRaw) ? subnetRaw : await deduceSubnet()
  const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`)

  const open = await scan(ips, 5555)

  const { rows } = await db.execute("SELECT id, name, ip, last_seen FROM devices WHERE ip IS NOT NULL AND ip != ''")
  const byIp = new Map((rows as any[]).map(r => [String(r.ip), r]))

  res.json({
    subnet,
    scanned: ips.length,
    devices: open.map(ip => {
      const known = byIp.get(ip)
      return {
        ip,
        adb_port: 5555,
        agent: known ? { id: known.id, name: known.name, last_seen: known.last_seen } : null,
      }
    }),
  })
})

export default router
