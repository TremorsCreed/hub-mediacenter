import { useEffect, useRef, useState } from 'react'
import { api, MediaNow, Device } from '../api'
import { useCurrentDeviceId } from '../usePersistentDevice'
import { usePersistedState } from '../usePersistedState'
import { launchRemote, canRemote } from '../remote'
import { Play, Pause, Square, Rewind, FastForward, Radio, Pin, PinOff, Music, MonitorPlay } from 'lucide-react'

// Badge couleur par app (cohérent avec les modules)
const APP_STYLE: Record<string, { label: string; cls: string }> = {
  youtube: { label: 'YouTube', cls: 'bg-red-600/20 text-red-400' },
  plex: { label: 'Plex', cls: 'bg-amber-600/20 text-amber-400' },
  netflix: { label: 'Netflix', cls: 'bg-red-700/20 text-red-400' },
  'disney+': { label: 'Disney+', cls: 'bg-blue-700/20 text-blue-300' },
  spotify: { label: 'Spotify', cls: 'bg-green-600/20 text-green-400' },
  vlc: { label: 'VLC', cls: 'bg-orange-600/20 text-orange-400' },
  justplayer: { label: 'Just Player', cls: 'bg-sky-600/20 text-sky-400' },
  mxplayer: { label: 'MX Player', cls: 'bg-blue-600/20 text-blue-400' },
  tivimate: { label: 'TiviMate', cls: 'bg-violet-600/20 text-violet-400' },
  iptv: { label: 'IPTV', cls: 'bg-emerald-600/20 text-emerald-400' },
  kodi: { label: 'Kodi', cls: 'bg-cyan-600/20 text-cyan-400' },
}

function fmt(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0
  const t = Math.floor(ms / 1000)
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
              : `${m}:${String(s).padStart(2, '0')}`
}

const POLL_MS = 1500
const HIDE_AFTER_NULLS = 3 // garde la barre ~4,5s après la fin (lisse les transitions entre films)

// Barre globale « lecture en cours » : pilote ce qui joue sur le device cible,
// quelle que soit l'app (YouTube, Plex, Just Player, VLC…) via MediaSession.
export default function NowPlayingBar() {
  const deviceId = useCurrentDeviceId()
  const [now, setNow] = useState<MediaNow | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [, forceTick] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [pinned, setPinned] = usePersistedState('hub.nowplaying.pin', false)
  const nullStreak = useRef(0)

  useEffect(() => { api.devices.list().then(setDevices).catch(() => {}) }, [])

  // Poll de l'état de lecture (1,5s). Anti-clignotement : on ne masque qu'après
  // plusieurs réponses vides d'affilée (sinon la barre disparaît à chaque
  // changement de film, le temps que la nouvelle session apparaisse).
  useEffect(() => {
    if (!deviceId) { setNow(null); return }
    let alive = true
    const tick = () => api.control.now(deviceId).then(m => {
      if (!alive) return
      if (m) { nullStreak.current = 0; setNow(m) }
      else { nullStreak.current++; if (nullStreak.current >= HIDE_AFTER_NULLS) setNow(null) }
    }).catch(() => {})
    nullStreak.current = 0
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [deviceId])

  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 500)
    return () => clearInterval(id)
  }, [])

  const device = devices.find(d => d.id === deviceId)
  const hasMedia = !!now && now.state !== 'stopped'

  // Masquée seulement si rien ne joue ET pas épinglée.
  if (!hasMedia && !pinned) return null

  const RemoteBtn = device && canRemote(device) ? (
    <button onClick={() => launchRemote(device.ip)} title={`Remote (miroir/contrôle) de ${device.name}`}
      className="p-2 rounded text-zinc-500 hover:text-amber-400 transition-colors">
      <MonitorPlay size={15} />
    </button>
  ) : null

  const PinBtn = (
    <button onClick={() => setPinned(!pinned)} title={pinned ? 'Détacher la barre' : 'Épingler la barre'}
      className={`p-2 rounded transition-colors ${pinned ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-500 hover:text-zinc-300'}`}>
      {pinned ? <Pin size={15} /> : <PinOff size={15} />}
    </button>
  )

  // Épinglée mais rien en lecture : barre « au repos »
  if (!hasMedia) {
    return (
      <div className="shrink-0 h-16 bg-zinc-900 border-t border-zinc-800 flex items-center gap-3 px-4">
        <Music size={16} className="text-zinc-600" />
        <div className="text-sm text-zinc-500 flex-1">
          Rien en lecture{device ? ` sur ${device.name}` : ''}
        </div>
        {RemoteBtn}
        {PinBtn}
      </div>
    )
  }

  const m = now as MediaNow
  const playing = m.state === 'playing'
  const livePos = playing ? m.position + (Date.now() - m.updated_at) : m.position
  const pos = scrub != null ? scrub : Math.min(livePos, m.duration || livePos)
  const hasBar = m.seekable && m.duration > 0
  const appStyle = APP_STYLE[m.app ?? ''] ?? { label: m.app ?? 'Lecture', cls: 'bg-zinc-700/40 text-zinc-300' }

  const ctrl = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch { /* */ } finally { setBusy(false) } }
  const seekTo = (ms: number) => ctrl(() => api.control.seek(deviceId, Math.max(0, Math.min(ms, m.duration || ms))))

  return (
    <div className="shrink-0 h-16 bg-zinc-900 border-t border-zinc-800 flex items-center gap-4 px-4">
      <div className="flex items-center gap-3 min-w-0 w-64 shrink-0">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${appStyle.cls}`}>
          {appStyle.label}
        </span>
        <div className="min-w-0">
          <div className="text-sm text-zinc-100 truncate font-medium">{m.title || 'Lecture en cours'}</div>
          {device && <div className="text-[11px] text-zinc-500 truncate">sur {device.name}</div>}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {hasBar && (
          <button onClick={() => seekTo(pos - 10000)} disabled={busy} title="−10 s"
            className="p-2 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors">
            <Rewind size={18} />
          </button>
        )}
        <button onClick={() => ctrl(() => api.control.send(deviceId, 'play_pause'))} disabled={busy} title="Play / Pause"
          className="p-2.5 rounded-full bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors">
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button onClick={() => ctrl(() => api.control.send(deviceId, 'stop'))} disabled={busy} title="Stop"
          className="p-2 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors">
          <Square size={16} fill="currentColor" />
        </button>
        {hasBar && (
          <button onClick={() => seekTo(pos + 10000)} disabled={busy} title="+10 s"
            className="p-2 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors">
            <FastForward size={18} />
          </button>
        )}
      </div>

      {hasBar ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[11px] tabular-nums text-zinc-400 w-12 text-right">{fmt(pos)}</span>
          <input
            type="range" min={0} max={m.duration} value={pos}
            onChange={e => setScrub(Number(e.target.value))}
            onMouseUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            onTouchEnd={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            onKeyUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            className="flex-1 h-1 accent-amber-500 cursor-pointer"
          />
          <span className="text-[11px] tabular-nums text-zinc-500 w-12">{fmt(m.duration)}</span>
        </div>
      ) : (
        <div className="flex-1 flex items-center">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
            <Radio size={13} /> En direct
          </span>
        </div>
      )}

      {RemoteBtn}
      {PinBtn}
    </div>
  )
}
