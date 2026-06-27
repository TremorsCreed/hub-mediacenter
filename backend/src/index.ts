import express from 'express'
import cors from 'cors'
import http from 'http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { initDb } from './db'
import { setupWebSocket } from './ws'
import devicesRouter from './routes/devices'
import discoverRouter from './routes/discover'
import playRouter from './routes/play'
import stateRouter from './routes/state'
import zaparooRouter from './routes/zaparoo'
import configRouter from './routes/config'
import plexRouter from './routes/plex'
import credentialsRouter from './routes/credentials'
import iptvRouter from './routes/iptv'
import controlRouter from './routes/control'
import launchboxRouter from './routes/launchbox'
import usersRouter from './routes/users'
import favoritesRouter from './routes/favorites'
import watchedRouter from './routes/watched'
import currentRouter from './routes/current'
import playlistsRouter from './routes/playlists'
import senscritiqueRouter from './routes/senscritique'
import traktRouter from './routes/trakt'
import traktAuthRouter from './routes/traktAuth'
import spotifyRouter from './routes/spotify'
import companionRouter from './routes/companion'
import llmRouter from './routes/llm'
import { attachUser, requireAdmin } from './auth'
import { preloadAll as preloadIptvVod, hydrate as hydrateIptvCache } from './iptvVodCache'
import { backfillWorks } from './migrations/backfillWorks'
import { startReminderChecker } from './epgReminders'
import { startScrobbler } from './scrobble'

const app = express()
const PORT = parseInt(process.env.PORT ?? '8020', 10)

// Identifiant de build backend (généré au `npm run build`, cf. dist/build-info.json).
// Exposé en /api/version pour vérifier l'alignement front/back dans l'UI.
let BUILD: { version: string; buildTime: string } = { version: '0.0.0', buildTime: '' }
try { BUILD = JSON.parse(readFileSync(join(__dirname, 'build-info.json'), 'utf8')) } catch { /* dev (tsx) : pas de stamp */ }

app.use(cors({ exposedHeaders: ['X-User-Id', 'X-Admin-Token'] }))
app.use(express.json())
app.use(attachUser) // attache req.userId depuis le header X-User-Id

app.use('/api/users', usersRouter)
app.use('/api/favorites', favoritesRouter)
app.use('/api/watched', watchedRouter)
app.use('/api/current', currentRouter)
app.use('/api/playlists', playlistsRouter)
app.use('/api/senscritique', senscritiqueRouter)
app.use('/api/trakt', traktAuthRouter)
app.use('/api/trakt', traktRouter)
app.use('/api/spotify', spotifyRouter)
app.use('/api/companion', companionRouter)
app.use('/api/llm', requireAdmin, llmRouter)
app.use('/api/devices/:id/config', requireAdmin, configRouter)
app.use('/api/devices', devicesRouter)
app.use('/api/discover', discoverRouter)
app.use('/api/play', playRouter)
app.use('/api/state', stateRouter)
app.use('/api/zaparoo', zaparooRouter)
app.use('/api/plex', plexRouter)
app.use('/api/credentials', requireAdmin, credentialsRouter)
app.use('/api/iptv', iptvRouter)
app.use('/api/control', controlRouter)
app.use('/api/launchbox', launchboxRouter)

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))
app.get('/api/version', (_req, res) => res.json(BUILD))

async function start() {
  await initDb()
  // Réhydrate le cache IPTV (listes + catégories) depuis la base AVANT tout fetch :
  // après un redeploy, une donnée < 1h évite tout appel provider, et la dernière
  // version connue reste servie même si le provider boude au démarrage.
  await hydrateIptvCache().catch(() => {})
  // Préchauffe les listes VOD IPTV en arrière-plan pour que le 1er cross-ref Discover
  // soit instantané. Ne bloque pas le démarrage.
  preloadIptvVod().catch(() => {})
  // Ancre les favoris/playlists existants sur des œuvres canoniques (idempotent).
  backfillWorks().catch(() => {})
  startReminderChecker()
  startScrobbler()
  const server = http.createServer(app)
  setupWebSocket(server)
  server.listen(PORT, () => {
    console.log(`Hub MediaCenter backend :${PORT}`)
    console.log(`WebSocket: ws://localhost:${PORT}/ws?device_id=<id>`)
  })
}

start().catch(console.error)
