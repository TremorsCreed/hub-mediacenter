import express from 'express'
import cors from 'cors'
import http from 'http'
import { initDb } from './db'
import { setupWebSocket } from './ws'
import devicesRouter from './routes/devices'
import catalogRouter from './routes/catalog'
import playRouter from './routes/play'
import stateRouter from './routes/state'
import zaparooRouter from './routes/zaparoo'
import configRouter from './routes/config'
import plexRouter from './routes/plex'
import credentialsRouter from './routes/credentials'
import iptvRouter from './routes/iptv'

const app = express()
const PORT = parseInt(process.env.PORT ?? '8020', 10)

app.use(cors())
app.use(express.json())

app.use('/api/devices', devicesRouter)
app.use('/api/devices/:id/config', configRouter)
app.use('/api/catalog', catalogRouter)
app.use('/api/play', playRouter)
app.use('/api/state', stateRouter)
app.use('/api/zaparoo', zaparooRouter)
app.use('/api/plex', plexRouter)
app.use('/api/credentials', credentialsRouter)
app.use('/api/iptv', iptvRouter)

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

async function start() {
  await initDb()
  const server = http.createServer(app)
  setupWebSocket(server)
  server.listen(PORT, () => {
    console.log(`Hub MediaCenter backend :${PORT}`)
    console.log(`WebSocket: ws://localhost:${PORT}/ws?device_id=<id>`)
  })
}

start().catch(console.error)
