import { useEffect, useRef, useState } from 'react'
import { api, MediaNow, Device } from '../api'
import { useCurrentDeviceId } from '../usePersistentDevice'
import { usePersistedState } from '../usePersistedState'
import { launchRemote, canRemote } from '../remote'
import Toast from './Toast'
import {
  Play, Pause, Square, Rewind, FastForward, Radio, Pin, PinOff, Music, MonitorPlay,
  Volume2, VolumeX, Minus, Plus, ArrowRightLeft,
} from 'lucide-react'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [pinned, setPinned] = usePersistedState('hub.nowplaying.pin', false)
  const nullStreak = useRef(0)

  useEffect(() => { api.devices.list().then(setDevices).catch(() => {}) }, [])

  const flash = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

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
      className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-500 hover:text-amber-400 transition-colors">
      <MonitorPlay size={15} />
    </button>
  ) : null

  const PinBtn = (
    <button onClick={() => setPinned(!pinned)} title={pinned ? 'Détacher la barre' : 'Épingler la barre'}
      className={`inline-flex items-center justify-center min-w-11 min-h-11 rounded transition-colors ${pinned ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-500 hover:text-zinc-300'}`}>
      {pinned ? <Pin size={15} /> : <PinOff size={15} />}
    </button>
  )

  // Épinglée mais rien en lecture : barre « au repos »
  if (!hasMedia) {
    return (
      <div className="shrink-0 h-20 bg-zinc-900 border-t border-zinc-800 flex items-center gap-3 px-4">
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

  // « Continuer sur… » : autres devices connectés (la cible ≠ source).
  const targets = devices.filter(d => d.id !== deviceId && d.ws_connected)
  const transfer = (to: Device) => {
    setMenuOpen(false)
    ctrl(async () => {
      try {
        const r = await api.transferPlayback(deviceId, to.id)
        const at = r.transferred_position_ms != null ? ` à ${fmt(r.transferred_position_ms)}` : ''
        flash(`Lecture transférée sur ${to.name}${at}`, true)
      } catch (e) {
        const msg = (e as Error).message
        flash(msg === 'media_not_transferable'
          ? 'Ce média ne peut pas être transféré (lancé hors du Hub ou live).'
          : `Échec du transfert : ${msg}`, false)
      }
    })
  }

  const VolIcon = m.muted ? VolumeX : Volume2

  return (
    <div className="shrink-0 h-20 bg-zinc-900 border-t border-zinc-800 flex items-center gap-4 px-4">
      {/* Miniature + titre */}
      <div className="flex items-center gap-3 min-w-0 w-72 shrink-0">
        <div className="relative h-14 w-14 shrink-0 rounded overflow-hidden bg-zinc-800 ring-1 ring-zinc-700/60">
          {m.thumb ? (
            <img src={m.thumb} alt="" className="h-full w-full object-cover" loading="lazy"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-zinc-600">
              <Music size={20} />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${appStyle.cls}`}>
            {appStyle.label}
          </span>
          <div className="text-sm text-zinc-100 truncate font-medium mt-0.5">{m.title || 'Lecture en cours'}</div>
          {device && <div className="text-[11px] text-zinc-400 truncate">sur {device.name}</div>}
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center gap-1 shrink-0">
        {hasBar && (
          <button onClick={() => seekTo(pos - 10000)} disabled={busy} title="−10 s"
            className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors">
            <Rewind size={18} />
          </button>
        )}
        <button onClick={() => ctrl(() => api.control.send(deviceId, 'play_pause'))} disabled={busy} title="Play / Pause"
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-full bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors">
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button onClick={() => ctrl(() => api.control.send(deviceId, 'stop'))} disabled={busy} title="Stop"
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors">
          <Square size={16} fill="currentColor" />
        </button>
        {hasBar && (
          <button onClick={() => seekTo(pos + 10000)} disabled={busy} title="+10 s"
            className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors">
            <FastForward size={18} />
          </button>
        )}
      </div>

      {/* Progression / Live */}
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
          <span className="text-[11px] tabular-nums text-zinc-400 w-12">{fmt(m.duration)}</span>
        </div>
      ) : (
        <div className="flex-1 flex items-center">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
            <Radio size={13} /> En direct
          </span>
        </div>
      )}

      {/* Volume relatif : crans − / mute / + transmis au device (et relayés à l'ampli
          via HDMI-CEC le cas échéant). Pas de slider absolu : quand le device délègue
          son volume à un AVR, il ne connaît pas le niveau réel → un absolu serait faux. */}
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => ctrl(() => api.control.send(deviceId, 'volume_down'))} disabled={busy} title="Baisser le volume"
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors">
          <Minus size={18} />
        </button>
        <button onClick={() => ctrl(() => api.control.send(deviceId, 'mute'))} disabled={busy}
          title={m.muted ? 'Réactiver le son' : 'Couper le son'}
          className={`inline-flex items-center justify-center min-w-11 min-h-11 rounded transition-colors disabled:opacity-40 ${m.muted ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
          <VolIcon size={18} />
        </button>
        <button onClick={() => ctrl(() => api.control.send(deviceId, 'volume_up'))} disabled={busy} title="Monter le volume"
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors">
          <Plus size={18} />
        </button>
      </div>

      {/* Continuer sur… */}
      {targets.length > 0 && (
        <div className="relative shrink-0">
          <button onClick={() => setMenuOpen(o => !o)} disabled={busy}
            title="Continuer la lecture sur un autre lecteur"
            className={`inline-flex items-center justify-center min-w-11 min-h-11 rounded transition-colors disabled:opacity-40 ${menuOpen ? 'text-amber-400' : 'text-zinc-500 hover:text-amber-400'}`}>
            <ArrowRightLeft size={16} />
          </button>
          {menuOpen && (
            <>
              {/* clic en dehors → ferme */}
              <div className="fixed inset-0 z-[105]" onClick={() => setMenuOpen(false)} />
              <div className="absolute bottom-full right-0 mb-2 z-[106] w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1">
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                  Continuer sur…
                </div>
                {targets.map(t => (
                  <button key={t.id} onClick={() => transfer(t)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700/70 text-left transition-colors">
                    <MonitorPlay size={14} className="text-zinc-400 shrink-0" />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {RemoteBtn}
      {PinBtn}
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  )
}
