import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { db } from '../db'

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
      sql: `INSERT OR REPLACE INTO lb_games (id, title, platform, publisher) VALUES ${placeholders}`,
      args
    })
  }
}

async function loadFromDb(): Promise<LbGame[]> {
  const rows = await db.execute('SELECT id, title, platform, publisher FROM lb_games ORDER BY title')
  return rows.rows.map(r => ({
    id: r[0] as string,
    title: r[1] as string,
    platform: r[2] as string,
    publisher: (r[3] as string) ?? ''
  }))
}

function buildPlatformsCache(games: LbGame[]) {
  return [...new Set(games.map(g => g.platform))].sort()
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

  res.json({ total: items.length, start, size: limit, items: items.slice(start, start + limit) })
})

// Proxy pochette : GET /game/id/{id}?binary=front côté MarquesasServer
// Le paramètre binary=front mappe sur la propriété IGame.FrontImagePath
router.get('/image/:id', async (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9\-_]/g, '_')
  const cacheFile = path.join(IMAGE_CACHE_DIR, safeId)

  // Servir depuis le cache disque si disponible
  if (fs.existsSync(cacheFile)) {
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.send(fs.readFileSync(cacheFile))
  }

  try {
    const r = await fetch(
      `${MARQUESAS}/game/id/${encodeURIComponent(req.params.id)}?binary=front`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!r.ok) return res.status(404).end()
    const buf = await r.arrayBuffer()
    const contentType = r.headers.get('content-type') ?? 'image/jpeg'

    // Sauvegarder en cache disque (en arrière-plan, pas de await bloquant)
    fs.promises.writeFile(cacheFile, Buffer.from(buf)).catch(() => {})

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(Buffer.from(buf))
  } catch {
    res.status(503).end()
  }
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
