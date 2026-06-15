import { useEffect, useRef, useState } from 'react'
import { api, MediaNow, Device, NowMeta } from '../api'
import { useCurrentDeviceId } from '../usePersistentDevice'
import { usePersistedState } from '../usePersistedState'
import { launchRemote, canRemote } from '../remote'
import Toast from './Toast'
import {
  Play, Pause, Square, Rewind, FastForward, Radio, Pin, PinOff, Music, MonitorPlay,
  Volume2, VolumeX, Minus, Plus, ArrowRightLeft, SkipForward, X, PanelRight, PanelBottom,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, CircleDot, Undo2, Home, Menu, Power,
} from 'lucide-react'

export type Dock = 'bottom' | 'right'

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

interface Props { dock: Dock; onToggleDock: () => void }

// Contrôle média global « lecture en cours » : pilote ce qui joue sur le device cible,
// quelle que soit l'app (YouTube, Plex, Just Player, VLC…) via MediaSession.
// Deux ancrages : barre en bas (horizontal) ou panneau à droite (vertical, plus d'infos).
export default function NowPlayingBar({ dock, onToggleDock }: Props) {
  const deviceId = useCurrentDeviceId()
  const [now, setNow] = useState<MediaNow | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [, forceTick] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [pinned, setPinned] = usePersistedState('hub.nowplaying.pin', false)
  const [meta, setMeta] = useState<NowMeta | null>(null)
  const nullStreak = useRef(0)
  const isRight = dock === 'right'

  // Métadonnées étendues (synopsis/genre/casting) du média en cours — seulement en
  // panneau droit, refetch quand le titre change (pas à chaque tick de position).
  useEffect(() => {
    if (dock !== 'right' || !deviceId || !now?.title || now.state === 'stopped' || now.up_next) { setMeta(null); return }
    let alive = true
    api.control.nowMeta(deviceId).then(mm => { if (alive) setMeta(mm) }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, dock, now?.title, now?.state])

  useEffect(() => { api.devices.list().then(setDevices).catch(() => {}) }, [])

  const flash = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  // Poll de l'état (1,5s) + anti-clignotement (ne masque qu'après plusieurs vides).
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

  // Barre d'espace = play/pause global (ignoré pendant la saisie / sur un bouton focus).
  useEffect(() => {
    if (!deviceId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || el?.isContentEditable) return
      e.preventDefault()
      api.control.send(deviceId, 'play_pause').catch(() => {})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deviceId])

  const device = devices.find(d => d.id === deviceId)
  const hasMedia = !!now && now.state !== 'stopped'

  if (!hasMedia && !pinned) return null

  const RemoteBtn = device && canRemote(device) ? (
    <button onClick={() => launchRemote(device.ip)} title={`Remote (miroir/contrôle) de ${device.name}`}
      className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-500 hover:text-amber-400 transition-colors">
      <MonitorPlay size={15} />
    </button>
  ) : null

  const DockBtn = (
    <button onClick={onToggleDock} title={isRight ? 'Ancrer la barre en bas' : 'Ancrer le panneau à droite'}
      className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-500 hover:text-amber-400 transition-colors">
      {isRight ? <PanelBottom size={15} /> : <PanelRight size={15} />}
    </button>
  )

  const PinBtn = (
    <button onClick={() => setPinned(!pinned)} title={pinned ? 'Détacher' : 'Épingler'}
      className={`inline-flex items-center justify-center min-w-11 min-h-11 rounded transition-colors ${pinned ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-500 hover:text-zinc-300'}`}>
      {pinned ? <Pin size={15} /> : <PinOff size={15} />}
    </button>
  )

  // ── Commandes du device, toujours disponibles (même sans lecture) ───────────
  // Volume (CEC relatif) + mini-télécommande de navigation (DPAD/back/home/menu/power,
  // injectée via ADB côté backend). Utilisées dans le panneau vertical (droite).
  const muted = !!now?.muted
  const VolIcon = muted ? VolumeX : Volume2
  const volBtn = 'inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors'
  const volumeControls = (
    <div className="flex items-center justify-center gap-1">
      <button onClick={() => api.control.send(deviceId, 'volume_down').catch(() => {})} title="Baisser le volume" className={volBtn}><Minus size={18} /></button>
      <button onClick={() => api.control.send(deviceId, 'mute').catch(() => {})} title={muted ? 'Réactiver le son' : 'Couper le son'}
        className={`inline-flex items-center justify-center min-w-11 min-h-11 rounded transition-colors ${muted ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}><VolIcon size={18} /></button>
      <button onClick={() => api.control.send(deviceId, 'volume_up').catch(() => {})} title="Monter le volume" className={volBtn}><Plus size={18} /></button>
    </div>
  )
  const nav = (key: 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'home' | 'menu' | 'power') => api.control.nav(deviceId, key).catch(() => {})
  const navCls = 'inline-flex items-center justify-center w-11 h-11 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white active:bg-amber-500/30 transition-colors'
  const miniRemote = (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5 w-fit mx-auto">
        <span /><button onClick={() => nav('up')} title="Haut" className={navCls}><ChevronUp size={18} /></button><span />
        <button onClick={() => nav('left')} title="Gauche" className={navCls}><ChevronLeft size={18} /></button>
        <button onClick={() => nav('ok')} title="OK" className={`${navCls} text-amber-400`}><CircleDot size={18} /></button>
        <button onClick={() => nav('right')} title="Droite" className={navCls}><ChevronRight size={18} /></button>
        <span /><button onClick={() => nav('down')} title="Bas" className={navCls}><ChevronDown size={18} /></button><span />
      </div>
      <div className="flex justify-center gap-1.5">
        <button onClick={() => nav('back')} title="Retour" className={navCls}><Undo2 size={16} /></button>
        <button onClick={() => nav('home')} title="Accueil" className={navCls}><Home size={16} /></button>
        <button onClick={() => nav('menu')} title="Menu" className={navCls}><Menu size={16} /></button>
        <button onClick={() => nav('power')} title="Veille / Power" className={navCls}><Power size={16} /></button>
      </div>
    </div>
  )
  const deviceControls = (
    <div className="space-y-3 pt-1">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold text-center">Commandes du device</div>
      {volumeControls}
      {miniRemote}
    </div>
  )

  // ── Repos (épinglé, rien en lecture) ───────────────────────────────────────
  if (!hasMedia) {
    if (isRight) return (
      <aside className="w-80 shrink-0 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-y-auto">
        <div className="flex flex-col items-center gap-2 text-zinc-500 p-6 pb-2">
          <Music size={28} className="text-zinc-600" />
          <div className="text-sm text-center">Rien en lecture{device ? ` sur ${device.name}` : ''}</div>
        </div>
        <div className="px-4 pb-4 flex-1">{deviceControls}</div>
        <div className="flex items-center justify-center gap-1 p-2 border-t border-zinc-800">{RemoteBtn}{DockBtn}{PinBtn}</div>
      </aside>
    )
    return (
      <div className="shrink-0 h-20 bg-zinc-900 border-t border-zinc-800 flex items-center gap-3 px-4">
        <Music size={16} className="text-zinc-600" />
        <div className="text-sm text-zinc-500 flex-1">Rien en lecture{device ? ` sur ${device.name}` : ''}</div>
        {RemoteBtn}{DockBtn}{PinBtn}
      </div>
    )
  }

  // ── Autoplay : compte à rebours « épisode suivant » ────────────────────────
  if (now?.up_next) {
    const secs = Math.max(0, Math.ceil((now.up_next.launches_at - Date.now()) / 1000))
    const launch = <button onClick={() => { api.control.playNextNow(deviceId).catch(() => {}) }}
      className="inline-flex items-center justify-center gap-1.5 px-3 min-h-11 rounded-full bg-amber-500 text-zinc-950 text-sm font-semibold hover:bg-amber-400 transition-colors">
      <Play size={15} fill="currentColor" /> Lancer</button>
    const cancel = <button onClick={() => { api.control.cancelNext(deviceId).catch(() => {}); setNow(null) }}
      className="inline-flex items-center justify-center gap-1.5 px-3 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 text-sm transition-colors">
      <X size={15} /> Annuler</button>
    if (isRight) return (
      <aside className="w-80 shrink-0 bg-zinc-900 border-l border-amber-500/40 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex items-center justify-center h-16 w-16 rounded-full bg-amber-500/15 text-amber-400"><SkipForward size={26} /></div>
          <div className="text-[11px] uppercase tracking-wider text-amber-400 font-semibold">À suivre · dans {secs}s</div>
          <div className="text-sm text-zinc-100 font-medium line-clamp-3">{now.up_next.title}</div>
          <div className="flex flex-col gap-2 w-full pt-2">{launch}{cancel}</div>
        </div>
        <div className="flex items-center justify-center gap-1 p-2 border-t border-zinc-800">{RemoteBtn}{DockBtn}{PinBtn}</div>
      </aside>
    )
    return (
      <div className="shrink-0 h-20 bg-zinc-900 border-t border-amber-500/40 flex items-center gap-4 px-4">
        <div className="flex items-center justify-center h-14 w-14 shrink-0 rounded bg-amber-500/15 text-amber-400"><SkipForward size={22} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-amber-400 font-semibold">À suivre · dans {secs}s</div>
          <div className="text-sm text-zinc-100 truncate font-medium">{now.up_next.title}</div>
          {device && <div className="text-[11px] text-zinc-400 truncate">sur {device.name}</div>}
        </div>
        {launch}{cancel}{RemoteBtn}{DockBtn}{PinBtn}
      </div>
    )
  }

  // ── Lecture en cours ───────────────────────────────────────────────────────
  const m = now as MediaNow
  const playing = m.state === 'playing'
  const livePos = playing ? m.position + (Date.now() - m.updated_at) : m.position
  const pos = scrub != null ? scrub : Math.min(livePos, m.duration || livePos)
  const hasBar = m.seekable && m.duration > 0
  const appStyle = APP_STYLE[m.app ?? ''] ?? { label: m.app ?? 'Lecture', cls: 'bg-zinc-700/40 text-zinc-300' }

  const ctrl = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch { /* */ } finally { setBusy(false) } }
  const seekTo = (ms: number) => ctrl(() => api.control.seek(deviceId, Math.max(0, Math.min(ms, m.duration || ms))))

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
        flash(msg === 'media_not_transferable' ? 'Ce média ne peut pas être transféré (lancé hors du Hub ou live).' : `Échec du transfert : ${msg}`, false)
      }
    })
  }

  // Fragments de contrôle partagés (mêmes handlers, réutilisés bas/droite).
  const transport = (
    <div className="flex items-center gap-1">
      {hasBar && (
        <button onClick={() => seekTo(pos - 10000)} disabled={busy} title="−10 s"
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors"><Rewind size={18} /></button>
      )}
      <button onClick={() => ctrl(() => api.control.send(deviceId, 'play_pause'))} disabled={busy} title="Play / Pause"
        className="inline-flex items-center justify-center min-w-12 min-h-12 rounded-full bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors">
        {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      <button onClick={() => ctrl(() => api.control.send(deviceId, 'stop'))} disabled={busy} title="Stop"
        className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors"><Square size={16} fill="currentColor" /></button>
      {hasBar && (
        <button onClick={() => seekTo(pos + 10000)} disabled={busy} title="+10 s"
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors"><FastForward size={18} /></button>
      )}
    </div>
  )

  const volume = (
    <div className="flex items-center gap-1">
      <button onClick={() => ctrl(() => api.control.send(deviceId, 'volume_down'))} disabled={busy} title="Baisser le volume"
        className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors"><Minus size={18} /></button>
      <button onClick={() => ctrl(() => api.control.send(deviceId, 'mute'))} disabled={busy} title={m.muted ? 'Réactiver le son' : 'Couper le son'}
        className={`inline-flex items-center justify-center min-w-11 min-h-11 rounded transition-colors disabled:opacity-40 ${m.muted ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}><VolIcon size={18} /></button>
      <button onClick={() => ctrl(() => api.control.send(deviceId, 'volume_up'))} disabled={busy} title="Monter le volume"
        className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors"><Plus size={18} /></button>
    </div>
  )

  const transferControl = targets.length > 0 ? (
    <div className={`relative ${isRight ? 'w-full' : ''}`}>
      <button onClick={() => setMenuOpen(o => !o)} disabled={busy} title="Continuer la lecture sur un autre lecteur"
        className={isRight
          ? `w-full inline-flex items-center justify-center gap-2 min-h-11 rounded-lg border text-sm transition-colors disabled:opacity-40 ${menuOpen ? 'text-amber-400 border-amber-500/50' : 'text-zinc-300 border-zinc-700 hover:text-amber-400 hover:border-amber-500/40'}`
          : `inline-flex items-center justify-center min-w-11 min-h-11 rounded transition-colors disabled:opacity-40 ${menuOpen ? 'text-amber-400' : 'text-zinc-500 hover:text-amber-400'}`}>
        <ArrowRightLeft size={16} />{isRight && <span>Continuer sur…</span>}
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-[105]" onClick={() => setMenuOpen(false)} />
          <div className="absolute bottom-full right-0 mb-2 z-[106] w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Continuer sur…</div>
            {targets.map(t => (
              <button key={t.id} onClick={() => transfer(t)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700/70 text-left transition-colors">
                <MonitorPlay size={14} className="text-zinc-400 shrink-0" /><span className="truncate">{t.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  ) : null

  // ── Panneau vertical (ancré à droite) — vue riche ──────────────────────────
  if (isRight) {
    return (
      <aside className="w-80 shrink-0 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-y-auto">
        <div className="relative w-full aspect-video bg-zinc-800 shrink-0">
          {m.thumb
            ? <img src={m.thumb} alt="" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Music size={32} /></div>}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent" />
        </div>
        <div className="p-4 space-y-4 flex-1">
          <div>
            <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${appStyle.cls}`}>{appStyle.label}</span>
            <div className="text-base text-zinc-100 font-semibold mt-1.5 line-clamp-3">{m.title || 'Lecture en cours'}</div>
            {device && <div className="text-xs text-zinc-400 mt-0.5">sur {device.name}</div>}
          </div>

          {meta && (meta.plot || meta.genre || meta.cast) && (
            <div className="space-y-1.5">
              {(meta.year || meta.genre || meta.rating) && (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                  {meta.year && <span>{meta.year}</span>}
                  {meta.genre && <span>· {meta.genre}</span>}
                  {meta.rating && <span>· ★ {meta.rating}</span>}
                </div>
              )}
              {meta.plot && <p className="text-xs text-zinc-300 leading-relaxed line-clamp-5">{meta.plot}</p>}
              {meta.cast && <div className="text-[11px] text-zinc-500 line-clamp-2">Avec {meta.cast}</div>}
            </div>
          )}

          {hasBar ? (
            <div>
              <input type="range" min={0} max={m.duration} value={pos}
                onChange={e => setScrub(Number(e.target.value))}
                onMouseUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
                onTouchEnd={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
                onKeyUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
                className="w-full h-1 accent-amber-500 cursor-pointer" />
              <div className="flex justify-between text-[11px] tabular-nums text-zinc-400 mt-1">
                <span>{fmt(pos)}</span><span>{fmt(m.duration)}</span>
              </div>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400"><Radio size={13} /> En direct</span>
          )}

          <div className="flex justify-center">{transport}</div>
          {transferControl}
          {deviceControls}
        </div>
        <div className="flex items-center justify-center gap-1 p-2 border-t border-zinc-800">{RemoteBtn}{DockBtn}{PinBtn}</div>
        {toast && <Toast msg={toast.msg} ok={toast.ok} />}
      </aside>
    )
  }

  // ── Barre horizontale (ancrée en bas) ──────────────────────────────────────
  return (
    <div className="shrink-0 h-20 bg-zinc-900 border-t border-zinc-800 flex items-center gap-4 px-4">
      <div className="flex items-center gap-3 min-w-0 w-72 shrink-0">
        <div className="relative h-14 w-14 shrink-0 rounded overflow-hidden bg-zinc-800 ring-1 ring-zinc-700/60">
          {m.thumb
            ? <img src={m.thumb} alt="" className="h-full w-full object-cover" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            : <div className="h-full w-full flex items-center justify-center text-zinc-600"><Music size={20} /></div>}
        </div>
        <div className="min-w-0">
          <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${appStyle.cls}`}>{appStyle.label}</span>
          <div className="text-sm text-zinc-100 truncate font-medium mt-0.5">{m.title || 'Lecture en cours'}</div>
          {device && <div className="text-[11px] text-zinc-400 truncate">sur {device.name}</div>}
        </div>
      </div>

      {transport}

      {hasBar ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[11px] tabular-nums text-zinc-400 w-12 text-right">{fmt(pos)}</span>
          <input type="range" min={0} max={m.duration} value={pos}
            onChange={e => setScrub(Number(e.target.value))}
            onMouseUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            onTouchEnd={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            onKeyUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            className="flex-1 h-1 accent-amber-500 cursor-pointer" />
          <span className="text-[11px] tabular-nums text-zinc-400 w-12">{fmt(m.duration)}</span>
        </div>
      ) : (
        <div className="flex-1 flex items-center">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400"><Radio size={13} /> En direct</span>
        </div>
      )}

      {volume}
      {transferControl}
      {RemoteBtn}{DockBtn}{PinBtn}
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  )
}
