import { Router, raw } from 'express'
import net from 'node:net'
import { execFile } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { db } from '../db'
import { requireAdmin } from '../auth'

const router = Router()

const AGENT_PKG = 'dev.tremors.hubagent'
const AGENT_LISTENER = `${AGENT_PKG}/${AGENT_PKG}.HubNotificationListener`
const APK_PATH = '/apk/app-debug.apk'

// Exécute adb (binaire android-tools dans l'image). Renvoie code + sortie fusionnée.
function adb(args: string[], timeoutMs = 30000): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile('adb', args, { timeout: timeoutMs }, (err: any, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout || ''}${stderr || ''}` })
    })
  })
}

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

// État de l'APK agent (présent ? taille ?) pour piloter l'UI de déploiement.
router.get('/agent-apk', requireAdmin, (_req, res) => {
  if (!existsSync(APK_PATH)) return res.json({ present: false })
  try { const { statSync } = require('node:fs'); res.json({ present: true, size: statSync(APK_PATH).size }) }
  catch { res.json({ present: true }) }
})

// Upload de l'APK de l'agent (raw octet-stream → /apk/app-debug.apk).
router.post('/agent-apk', requireAdmin, raw({ type: '*/*', limit: '120mb' }), (req, res) => {
  const buf = req.body as Buffer
  if (!buf || !buf.length) return res.status(400).json({ error: 'fichier vide' })
  // Vérif sommaire : un APK est un ZIP (magic "PK\x03\x04")
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return res.status(400).json({ error: 'ce n\'est pas un APK (.apk)' })
  try { mkdirSync('/apk', { recursive: true }); writeFileSync(APK_PATH, buf); res.json({ ok: true, size: buf.length }) }
  catch (e: any) { res.status(500).json({ error: e.message }) }
})

// POST /api/discover/:ip/deploy — déploie l'agent sur un lecteur Android via adb.
// Flux : connect → (autorisation requise ?) → install -r → permissions (overlay +
// accès notifications) → lancement. La 1re fois, l'appareil demande d'autoriser la
// clé adb : on renvoie status='authorize' et l'utilisateur relance après avoir
// accepté la popup sur l'écran de l'appareil.
router.post('/:ip/deploy', requireAdmin, async (req, res) => {
  const ip = req.params.ip
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return res.status(400).json({ error: 'ip invalide' })
  if (!existsSync(APK_PATH)) return res.status(400).json({ status: 'no_apk', message: 'Aucun APK agent. Uploade-le d\'abord.' })

  const serial = `${ip}:5555`
  await adb(['connect', serial], 12000)
  const devs = await adb(['devices'], 10000)

  if (devs.out.includes(`${serial}\tunauthorized`)) {
    return res.json({ status: 'authorize', message: 'Autorise « débogage USB » sur l\'écran de l\'appareil (coche « toujours autoriser »), puis relance le déploiement.' })
  }
  if (!devs.out.includes(`${serial}\tdevice`)) {
    return res.status(502).json({ status: 'error', message: `Appareil injoignable en ADB. adb devices:\n${devs.out.trim()}` })
  }

  const inst = await adb(['-s', serial, 'install', '-r', '-g', APK_PATH], 180000)
  if (!/Success/i.test(inst.out)) {
    return res.status(502).json({ status: 'error', message: `Échec install: ${inst.out.trim().slice(0, 400)}` })
  }

  // Permissions best-effort (n'empêchent pas le succès si elles échouent)
  await adb(['-s', serial, 'shell', 'appops', 'set', AGENT_PKG, 'SYSTEM_ALERT_WINDOW', 'allow'])
  await adb(['-s', serial, 'shell', 'cmd', 'notification', 'allow_listener', AGENT_LISTENER])
  // Lancement de l'agent
  await adb(['-s', serial, 'shell', 'monkey', '-p', AGENT_PKG, '-c', 'android.intent.category.LAUNCHER', '1'])

  res.json({ status: 'ok', message: 'Agent installé, permissions accordées et lancé. Il va se connecter au Hub.' })
})

export default router
