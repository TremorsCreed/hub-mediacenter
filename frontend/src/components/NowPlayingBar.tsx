import { useEffect, useRef, useState } from 'react'
import { api, MediaNow, Device } from '../api'
import { useCurrentDeviceId } from '../usePersistentDevice'
import { Play, Pause, Square, Rewind, FastForward, Radio } from 'lucide-react'

// Badge couleur par app (cohérent avec les modules)
const APP_STYLE: Record<string, { label: string; cls: string }> = {
  youtube: { label: 'YouTube', cls: 'bg-red-600/20 text-red-400' },
  plex: { label: 'Plex', cls: 'bg-amber-600/20 text-amber-400' },
  netflix: { label: 'Netflix', cls: 'bg-red-700/20 text-red-400' },
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

// Barre globale « lecture en cours » : pilote ce qui joue sur le device cible,
// quelle que soit l'app (YouTube, Plex, Just Player, VLC…) via MediaSession.
export default function NowPlayingBar() {
  const deviceId = useCurrentDeviceId()
  const [now, setNow] = useState<MediaNow | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [, forceTick] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null) // position en cours de drag
  const [busy, setBusy] = useState(false)

  // Liste des devices (pour afficher le nom de la cible)
  useEffect(() => { api.devices.list().then(setDevices).catch(() => {}) }, [])

  // Poll de l'état de lecture du device cible (2s). Reset si on change de device.
  useEffect(() => {
    if (!deviceId) { setNow(null); return }
    let alive = true
    const tick = () => { api.control.now(deviceId).then(m => { if (alive) setNow(m) }).catch(() => { if (alive) setNow(null) }) }
    tick()
    const id = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(id) }
  }, [deviceId])

  // Avance la barre entre deux polls (re-render léger 2x/s)
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 500)
    return () => clearInterval(id)
  }, [])

  if (!deviceId || !now || now.state === 'stopped') return null

  const playing = now.state === 'playing'
  // Position extrapolée pendant la lecture (le serveur n'envoie qu'un instantané)
  const livePos = playing ? now.position + (Date.now() - now.updated_at) : now.position
  const pos = scrub != null ? scrub : Math.min(livePos, now.duration || livePos)
  const hasBar = now.seekable && now.duration > 0
  const device = devices.find(d => d.id === deviceId)
  const appStyle = APP_STYLE[now.app ?? ''] ?? { label: now.app ?? 'Lecture', cls: 'bg-zinc-700/40 text-zinc-300' }

  const ctrl = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch { /* */ } finally { setBusy(false) } }
  const seekTo = (ms: number) => ctrl(() => api.control.seek(deviceId, Math.max(0, Math.min(ms, now.duration || ms))))

  return (
    <div className="shrink-0 h-16 bg-zinc-900 border-t border-zinc-800 flex items-center gap-4 px-4">
      {/* Infos : app + titre + device */}
      <div className="flex items-center gap-3 min-w-0 w-64 shrink-0">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${appStyle.cls}`}>
          {appStyle.label}
        </span>
        <div className="min-w-0">
          <div className="text-sm text-zinc-100 truncate font-medium">{now.title || 'Lecture en cours'}</div>
          {device && <div className="text-[11px] text-zinc-500 truncate">sur {device.name}</div>}
        </div>
      </div>

      {/* Transport */}
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

      {/* Scrubber (VOD/séries) ou badge EN DIRECT (live) */}
      {hasBar ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[11px] tabular-nums text-zinc-400 w-12 text-right">{fmt(pos)}</span>
          <input
            type="range" min={0} max={now.duration} value={pos}
            onChange={e => setScrub(Number(e.target.value))}
            onMouseUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            onTouchEnd={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            onKeyUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            className="flex-1 h-1 accent-amber-500 cursor-pointer"
          />
          <span className="text-[11px] tabular-nums text-zinc-500 w-12">{fmt(now.duration)}</span>
        </div>
      ) : (
        <div className="flex-1 flex items-center">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
            <Radio size={13} /> En direct
          </span>
        </div>
      )}
    </div>
  )
}
