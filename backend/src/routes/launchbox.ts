import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import net from 'net'
import { URL } from 'url'
import { db } from '../db'
import { agents } from '../ws'

// MarquesasServer tourne sur le PC Windows (LaunchBox plugin HTTP)
// Dev local : http://localhost:80 (ou 8090 après restart LaunchBox)
// Prod Docker : http://192.168.1.223:8090
const MARQUESAS = (process.env.MARQUESAS_URL ?? 'http://localhost:80').replace(/\/$/, '')
const CACHE_TTL_MS = 5 * 60 * 1000

// Dossier de cache des pochettes sur disque (dans le volume persistant en prod)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'lb-image-cache')
if (!fs.existsSync(IMAGE_CACHE_DIR)) fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true })

interface LbGame {
  id: string
  title: string
  platform: string
  publisher: string
}

let gamesCache: LbGame[] = []
let platformsCache: string[] = []
let lastLoaded = 0

async function persistGames(games: LbGame[]) {
  if (games.length === 0) return
  await db.execute('DELETE FROM lb_games')
  const CHUNK = 100
  for (let i = 0; i < games.length; i += CHUNK) {
    const chunk = games.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ')
    const args = chunk.flatMap(g => [g.id, g.title, g.platform, g.publisher])
    await db.execute({
      sql: `INSERT INTO lb_games (id, title, platform, publisher) VALUES ${placeholders}
            ON CONFLICT (id) DO UPDATE SET title = excluded.title, platform = excluded.platform, publisher = excluded.publisher`,
      args
    })
  }
}

async function loadFromDb(): Promise<LbGame[]> {
  const rows = await db.execute('SELECT id, title, platform, publisher FROM lb_games ORDER BY title')
  return rows.rows.map((r: any) => ({
    id: r.id as string,
    title: r.title as string,
    platform: r.platform as string,
    publisher: (r.publisher as string) ?? ''
  }))
}

function buildPlatformsCache(games: LbGame[]) {
  return [...new Set(games.map(g => g.platform))].sort()
}

/**
 * Fetch binaire via TCP brut + parsing HTTP manuel.
 * MarquesasServer renvoie le contenu (PNG/JPG) parfois sans headers HTTP valides
 * (réponse qui commence direct par les octets `\x89PNG…`), ce qui fait planter
 * undici (HPE_INVALID_CONSTANT). On lit tout le buffer puis on détecte si la
 * réponse commence par "HTTP/" : si oui on skip les headers, sinon on prend tout.
 */
function fetchBinaryRaw(rawUrl: string, timeoutMs = 8000): Promise<{ body: Buffer; contentType: string } | null> {
  return new Promise((resolve) => {
    let url: URL
    try { url = new URL(rawUrl) } catch { return resolve(null) }
    const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80)
    const host = url.hostname
    const path = url.pathname + url.search

    const socket = net.connect({ host, port })
    const chunks: Buffer[] = []
    let done = false
    const finish = (result: { body: Buffer; contentType: string } | null) => {
      if (done) return
      done = true
      try { socket.destroy() } catch {}
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => finish(null))
    socket.on('error', () => finish(null))
    socket.on('connect', () => {
      socket.write(
        `GET ${path} HTTP/1.0\r\n` +
        `Host: ${host}\r\n` +
        `User-Agent: hub-mediacenter/1.0\r\n` +
        `Accept: */*\r\n` +
        `Connection: close\r\n\r\n`
      )
    })
    socket.on('data', (chunk) => { chunks.push(chunk) })
    socket.on('end', () => {
      const raw = Buffer.concat(chunks)
      if (raw.length === 0) return finish(null)
      // Si ça commence par "HTTP/", parser les headers et trouver \r\n\r\n
      if (raw.slice(0, 5).toString('ascii') === 'HTTP/') {
        const sep = raw.indexOf('\r\n\r\n')
        if (sep === -1) return finish(null)
        const headersStr = raw.slice(0, sep).toString('latin1')
        const body = raw.slice(sep + 4)
        const statusMatch = headersStr.match(/^HTTP\/\d\.\d (\d+)/)
        const status = statusMatch ? parseInt(statusMatch[1], 10) : 0
        if (status < 200 || status >= 300) return finish(null)
        const ctMatch = headersStr.match(/^content-type:\s*(.+)$/im)
        return finish({ body, contentType: ctMatch ? ctMatch[1].trim() : 'image/jpeg' })
      }
      // Pas de header HTTP : tout le buffer est le binaire
      // Détecter le mime par les magic bytes
      const head4 = raw.slice(0, 4)
      let ct = 'image/jpeg'
      if (head4[0] === 0x89 && head4[1] === 0x50 && head4[2] === 0x4E && head4[3] === 0x47) ct = 'image/png'
      else if (head4[0] === 0xFF && head4[1] === 0xD8) ct = 'image/jpeg'
      else if (head4.toString('ascii') === 'GIF8') ct = 'image/gif'
      finish({ body: raw, contentType: ct })
    })
  })
}

async function ensureCache() {
  if (Date.now() - lastLoaded < CACHE_TTL_MS) return

  try {
    const r = await fetch(`${MARQUESAS}/getallgames`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) throw new Error(`MarquesasServer ${r.status}`)
    const raw = await r.json() as Array<{ Id: string; Title: string; Platform: string; Publisher?: string }>
    gamesCache = raw.map(g => ({ id: g.Id, title: g.Title, platform: g.Platform, publisher: g.Publisher ?? '' }))
    platformsCache = buildPlatformsCache(gamesCache)
    lastLoaded = Date.now()
    // Persistance SQLite en arrière-plan
    persistGames(gamesCache).catch(e => console.error('[launchbox] persist error:', e))
  } catch (e) {
    // Fallback SQLite si MarquesasServer inaccessible
    try {
      const games = await loadFromDb()
      if (games.length > 0) {
        gamesCache = games
        platformsCache = buildPlatformsCache(gamesCache)
        lastLoaded = Date.now()
        console.log(`[launchbox] MarquesasServer offline — ${gamesCache.length} jeux servis depuis SQLite`)
        return
      }
    } catch { /* ignorer l'erreur DB, re-lever l'erreur réseau */ }
    throw e
  }
}

const router = Router()

router.get('/platforms', async (_req, res) => {
  try {
    await ensureCache()
    res.json(platformsCache)
  } catch (e: any) {
    res.status(503).json({ error: e.message })
  }
})

router.get('/games', async (req, res) => {
  try { await ensureCache() } catch (e: any) { return res.status(503).json({ error: e.message }) }

  const q = ((req.query.q as string) ?? '').toLowerCase().trim()
  const platform = req.query.platform as string | undefined
  const start = Math.max(0, parseInt((req.query.start as string) ?? '0', 10))
  const limit = Math.min(200, parseInt((req.query.limit as string) ?? '60', 10))

  let items = gamesCache
  if (platform) items = items.filter(g => g.platform === platform)
  if (q) items = items.filter(g => g.title.toLowerCase().includes(q))

  // Tri (avant pagination). '' = ordre du cache (LaunchBox).
  const sort = (req.query.sort as string) ?? ''
  if (sort === 'title_asc') items = [...items].sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }))
  else if (sort === 'title_desc') items = [...items].sort((a, b) => b.title.localeCompare(a.title, 'fr', { sensitivity: 'base' }))

  res.json({ total: items.length, start, size: limit, items: items.slice(start, start + limit) })
})

// Proxy pochette : GET /game/id/{id}?binary=front côté MarquesasServer.
// Le paramètre binary=front mappe sur la propriété IGame.FrontImagePath.
// MarquesasServer renvoie parfois les octets binaires SANS headers HTTP valides
// (réponse qui démarre direct par \x89PNG…), donc on utilise un fetch TCP brut.
router.get('/image/:id', async (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9\-_]/g, '_')
  const cacheFile = path.join(IMAGE_CACHE_DIR, safeId)
  const cacheMetaFile = cacheFile + '.ct'

  // Servir depuis le cache disque si disponible
  if (fs.existsSync(cacheFile)) {
    let ct = 'image/jpeg'
    try { if (fs.existsSync(cacheMetaFile)) ct = fs.readFileSync(cacheMetaFile, 'utf-8').trim() || ct } catch {}
    res.setHeader('Content-Type', ct)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.send(fs.readFileSync(cacheFile))
  }

  const url = `${MARQUESAS}/game/id/${encodeURIComponent(req.params.id)}?binary=front`
  const result = await fetchBinaryRaw(url, 8000)
  if (!result || result.body.length === 0) return res.status(404).end()

  // Sauvegarder en cache disque + content-type sidecar (en arrière-plan)
  fs.promises.writeFile(cacheFile, result.body).catch(() => {})
  fs.promises.writeFile(cacheMetaFile, result.contentType).catch(() => {})

  res.setHeader('Content-Type', result.contentType)
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(result.body)
})

router.post('/launch', async (req, res) => {
  const { game_id } = req.body ?? {}
  if (!game_id || typeof game_id !== 'string') return res.status(400).json({ error: 'game_id required' })

  try {
    await ensureCache()
    const game = gamesCache.find(g => g.id === game_id)
    if (!game) return res.status(404).json({ error: 'game not found' })

    const r = await fetch(`${MARQUESAS}/playgame/id/${encodeURIComponent(game_id)}`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      return res.status(502).json({ error: `MarquesasServer ${r.status} ${body}`.trim() })
    }
    res.json({ ok: true, title: game.title })
  } catch (e: any) {
    res.status(503).json({ error: `MarquesasServer inaccessible (${MARQUESAS}) : ${e.message}` })
  }
})

// Lit l'état "isInGame" depuis MarquesasServer (via fetch TCP brut au cas où la
// réponse soit malformée, comme pour les images).
router.get('/state', async (_req, res) => {
  try {
    const r = await fetch(`${MARQUESAS}/statemanager/isingame`, { signal: AbortSignal.timeout(5_000) })
    const txt = await r.text()
    res.json({ in_game: txt.trim() === 'true', raw: txt.trim() })
  } catch (e: any) {
    res.status(503).json({ error: e.message, in_game: null })
  }
})

// Force le reset de MarquesasServer en demandant au PC Windows de tuer
// LaunchBox.exe (et de le relancer). Nécessite qu'un agent-pc Windows soit
// connecté en WebSocket. Renvoie 503 si aucun agent disponible.
router.post('/reset', async (req, res) => {
  // Cherche un agent Windows connecté
  const { rows } = await db.execute({
    sql: "SELECT id FROM devices WHERE platform = ? ORDER BY last_seen DESC",
    args: ['pc_windows']
  })

  let targetAgent: { ws: any; device_id: string } | undefined
  for (const r of rows) {
    const id = (r as any).id as string
    const a = agents.get(id)
    if (a && a.ws.readyState === 1) { targetAgent = a; break }
  }

  if (!targetAgent) {
    return res.status(503).json({
      error: 'Aucun agent PC Windows connecté. Lance hub-agent.exe sur le PC LaunchBox.'
    })
  }

  const relaunch = req.body?.relaunch !== false
  const requestId = `reset-${Date.now()}`
  targetAgent.ws.send(JSON.stringify({
    type: 'launchbox_reset',
    relaunch,
    request_id: requestId,
  }))
  console.log(`[launchbox] sent reset to ${targetAgent.device_id} (relaunch=${relaunch})`)
  res.json({
    ok: true,
    sent_to: targetAgent.device_id,
    relaunch,
    note: 'LaunchBox sera tué et relancé sur le PC. Attendre ~5s avant de retenter un launch.'
  })
})

router.post('/reload', async (_req, res) => {
  lastLoaded = 0
  try {
    await ensureCache()
    res.json({ ok: true, games: gamesCache.length, platforms: platformsCache.length })
  } catch (e: any) {
    res.status(503).json({ error: e.message })
  }
})

export default router
