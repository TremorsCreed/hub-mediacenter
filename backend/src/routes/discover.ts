import { Router, raw } from 'express'
import net from 'node:net'
import { execFile } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../db'
import { requireAdmin } from '../auth'

const router = Router()

const AGENT_PKG = 'dev.tremors.hubagent'
const AGENT_LISTENER = `${AGENT_PKG}/${AGENT_PKG}.HubNotificationListener`
const APK_PATH = '/apk/app-debug.apk'

// ── Magasin de lecteurs (APK sideloadés en plus de l'agent) ──────────────────
// Pour les appareils sans Play Store (Fire TV) : on pousse les APK directement.
const STORE_DIR = '/apk/store'
interface StoreApp { id: string; label: string; file: string; size: number }

function readStore(): StoreApp[] {
  try {
    return readdirSync(STORE_DIR)
      .filter(f => f.toLowerCase().endsWith('.apk'))
      .map(f => ({ id: f.replace(/\.apk$/i, ''), label: f.replace(/\.apk$/i, '').replace(/_/g, ' '), file: join(STORE_DIR, f), size: statSync(join(STORE_DIR, f)).size }))
  } catch { return [] }
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `app_${Date.now()}`
}

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
  try { res.json({ present: true, size: statSync(APK_PATH).size }) }
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

// ── Magasin de lecteurs ──────────────────────────────────────────────────────
// Liste les lecteurs disponibles à pousser.
router.get('/players', requireAdmin, (_req, res) => {
  res.json(readStore().map(a => ({ id: a.id, label: a.label, size: a.size })))
})

// Upload d'un APK de lecteur (raw). ?label=Just Player → fichier just_player.apk
router.post('/players', requireAdmin, raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const buf = req.body as Buffer
  if (!buf || !buf.length) return res.status(400).json({ error: 'fichier vide' })
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return res.status(400).json({ error: 'ce n\'est pas un APK' })
  const id = slug((req.query.label as string) || `app_${Date.now()}`)
  try { mkdirSync(STORE_DIR, { recursive: true }); writeFileSync(join(STORE_DIR, `${id}.apk`), buf); res.json({ ok: true, id, size: buf.length }) }
  catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.delete('/players/:id', requireAdmin, (req, res) => {
  const id = slug(req.params.id)
  const p = join(STORE_DIR, `${id}.apk`)
  try { if (existsSync(p)) unlinkSync(p); res.json({ ok: true }) }
  catch (e: any) { res.status(500).json({ error: e.message }) }
})

// Récupère la dernière version de Just Player (open source) depuis GitHub.
router.post('/players/fetch-justplayer', requireAdmin, async (_req, res) => {
  try {
    const rel: any = await (await fetch('https://api.github.com/repos/moneytoo/Player/releases/latest', {
      headers: { 'User-Agent': 'hub-mediacenter', Accept: 'application/vnd.github+json' },
    })).json()
    const asset = (rel.assets || []).find((a: any) => /universal.*\.apk$|\.apk$/i.test(a.name))
    if (!asset) return res.status(502).json({ error: 'APK introuvable dans la release' })
    const apk = Buffer.from(await (await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'hub-mediacenter' } })).arrayBuffer())
    if (!(apk[0] === 0x50 && apk[1] === 0x4b)) return res.status(502).json({ error: 'téléchargement invalide' })
    mkdirSync(STORE_DIR, { recursive: true })
    writeFileSync(join(STORE_DIR, 'just_player.apk'), apk)
    res.json({ ok: true, version: rel.tag_name, size: apk.length, asset: asset.name })
  } catch (e: any) { res.status(502).json({ error: `GitHub: ${e.message}` }) }
})

// POST /api/discover/:ip/install-players — pousse les lecteurs du magasin sur un
// appareil (sans toucher l'agent). Pour les appareils déjà gérés où les lecteurs
// manquent. Même flux d'autorisation ADB que /deploy.
router.post('/:ip/install-players', requireAdmin, async (req, res) => {
  const ip = req.params.ip
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return res.status(400).json({ error: 'ip invalide' })
  const store = readStore()
  if (!store.length) return res.status(400).json({ status: 'no_players', message: 'Magasin vide — récupère Just Player ou uploade un lecteur.' })

  const serial = `${ip}:5555`
  await adb(['connect', serial], 12000)
  const devs = await adb(['devices'], 10000)
  if (devs.out.includes(`${serial}\tunauthorized`)) {
    return res.json({ status: 'authorize', message: 'Autorise « débogage USB » sur l\'écran de l\'appareil (coche « toujours autoriser »), puis relance.' })
  }
  if (!devs.out.includes(`${serial}\tdevice`)) {
    return res.status(502).json({ status: 'error', message: `Appareil injoignable en ADB.\n${devs.out.trim()}` })
  }

  const installed: string[] = [], failed: string[] = []
  for (const app of store) {
    const r = await adb(['-s', serial, 'install', '-r', '-g', app.file], 180000)
    if (/Success/i.test(r.out)) installed.push(app.label); else failed.push(app.label)
  }
  let msg = installed.length ? `Lecteurs installés : ${installed.join(', ')}.` : 'Aucun lecteur installé.'
  if (failed.length) msg += ` Échec : ${failed.join(', ')}.`
  res.json({ status: 'ok', message: msg })
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
    return res.status(502).json({ status: 'error', message: `Échec install agent: ${inst.out.trim().slice(0, 400)}` })
  }

  // Permissions best-effort (n'empêchent pas le succès si elles échouent)
  await adb(['-s', serial, 'shell', 'appops', 'set', AGENT_PKG, 'SYSTEM_ALERT_WINDOW', 'allow'])
  await adb(['-s', serial, 'shell', 'cmd', 'notification', 'allow_listener', AGENT_LISTENER])

  // Lecteurs du magasin (Just Player, MX Player…) — sideload direct (Fire TV & co).
  const players = (req.body?.players as string[] | undefined)
  const store = readStore().filter(a => !players || players.includes(a.id))
  const installed: string[] = [], failed: string[] = []
  for (const app of store) {
    const r = await adb(['-s', serial, 'install', '-r', '-g', app.file], 180000)
    if (/Success/i.test(r.out)) installed.push(app.label); else failed.push(app.label)
  }

  // Lancement de l'agent
  await adb(['-s', serial, 'shell', 'monkey', '-p', AGENT_PKG, '-c', 'android.intent.category.LAUNCHER', '1'])

  let msg = 'Agent installé, permissions accordées et lancé.'
  if (installed.length) msg += ` Lecteurs installés : ${installed.join(', ')}.`
  if (failed.length) msg += ` Échec : ${failed.join(', ')}.`
  res.json({ status: 'ok', message: msg })
})

export default router
