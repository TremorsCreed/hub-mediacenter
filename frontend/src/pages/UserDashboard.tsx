import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, Device, Favorite, ProgressItem, PlexOnDeckItem, DashboardPrefs } from '../api'
import { usePersistentDevice } from '../usePersistentDevice'
import { useUser, initials } from '../UserContext'
import { useFavorites } from '../FavoritesContext'
import Toast from '../components/Toast'
import {
  Heart, Play, Loader2, Tv, Film, Gamepad2, MonitorPlay, Radio, Compass, ListMusic,
  RotateCcw, Settings2, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, X,
} from 'lucide-react'

// ── Rangées disponibles + ordre par défaut ───────────────────────────────────
type RailId = 'resume' | 'favorites' | 'ondeck' | 'quick'
const RAIL_META: Record<RailId, { label: string }> = {
  resume: { label: 'Reprendre' },
  favorites: { label: 'Mes favoris' },
  ondeck: { label: 'À suivre sur Plex' },
  quick: { label: 'Accès rapide' },
}
const DEFAULT_RAILS: { id: RailId; on: boolean }[] = [
  { id: 'resume', on: true }, { id: 'favorites', on: true }, { id: 'ondeck', on: true }, { id: 'quick', on: true },
]

// Fusionne les prefs stockées avec la liste par défaut (ids inconnus ignorés, manquants ajoutés).
function normalizeRails(prefs: DashboardPrefs | null | undefined): { id: RailId; on: boolean }[] {
  const valid = new Set<string>(Object.keys(RAIL_META))
  const stored = (prefs?.rails ?? []).filter(r => valid.has(r.id)) as { id: RailId; on: boolean }[]
  const seen = new Set(stored.map(r => r.id))
  for (const d of DEFAULT_RAILS) if (!seen.has(d.id)) stored.push(d)
  return stored.length ? stored : [...DEFAULT_RAILS]
}

function fmt(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0
  const t = Math.floor(ms / 1000)
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60)
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

const QUICK_TILES: { label: string; to: string; icon: typeof Tv; grad: string }[] = [
  { label: 'IPTV', to: '/catalog/iptv', icon: Radio, grad: 'from-emerald-600/30 to-emerald-900/5' },
  { label: 'Plex', to: '/catalog/plex', icon: Film, grad: 'from-amber-600/30 to-amber-900/5' },
  { label: 'Jeux', to: '/catalog/launchbox', icon: Gamepad2, grad: 'from-cyan-600/30 to-cyan-900/5' },
  { label: 'Découvrir', to: '/catalog/discover', icon: Compass, grad: 'from-violet-600/30 to-violet-900/5' },
  { label: 'Playlists', to: '/playlists', icon: ListMusic, grad: 'from-rose-600/30 to-rose-900/5' },
]

const APP_ICON: Record<string, typeof Tv> = { iptv: Radio, plex: Film, launchbox: Gamepad2, catalog: MonitorPlay }
function favImg(f: Favorite): string {
  if (!f.thumb) return ''
  if (f.app === 'launchbox') return f.thumb
  if (f.app === 'plex') return api.plex.imageUrl(f.thumb)
  return api.iptv.imageUrl(f.thumb)
}

// Conteneur de rangée scrollable horizontalement (flèches au desktop).
function Rail({ icon: Icon, title, count, children }: { icon: typeof Tv; title: string; count?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className="text-amber-400" />
        <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">{title}</h2>
        {count != null && <span className="text-xs text-zinc-600">{count}</span>}
        <div className="ml-auto hidden sm:flex gap-1">
          <button onClick={() => scroll(-1)} aria-label="Précédent"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => scroll(1)} aria-label="Suivant"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div ref={ref} className="flex gap-3 overflow-x-auto scrollbar-thin snap-x pb-2 -mx-1 px-1">
        {children}
      </div>
    </section>
  )
}

export default function UserDashboard() {
  const { currentUser, adminUnlocked } = useUser()
  const { favorites, toggle } = useFavorites()
  const navigate = useNavigate()
  const [devices, setDevices] = useState<Device[]>([])
  const { deviceId, setDeviceId, reconcile } = usePersistentDevice()
  const [resume, setResume] = useState<ProgressItem[]>([])
  const [onDeck, setOnDeck] = useState<PlexOnDeckItem[]>([])
  const [launching, setLaunching] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [editing, setEditing] = useState(false)
  const [rails, setRails] = useState(() => normalizeRails(currentUser?.dashboard_prefs))
  const [autoplay, setAutoplay] = useState(currentUser?.autoplay_next ?? true)

  useEffect(() => { api.devices.list().then(ds => { setDevices(ds); reconcile(ds) }).catch(() => {}) }, [])
  useEffect(() => {
    api.state.progress().then(setResume).catch(() => {})
    api.plex.onDeck(20).then(setOnDeck).catch(() => setOnDeck([]))
  }, [currentUser])

  const flash = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  // ── Persistance perso (self-service) ───────────────────────────────────────
  const saveRails = (next: { id: RailId; on: boolean }[]) => {
    setRails(next)
    if (currentUser) api.users.savePrefs(currentUser.id, { dashboard_prefs: { rails: next } }).catch(() => {})
  }
  const moveRail = (i: number, dir: number) => {
    const j = i + dir
    if (j < 0 || j >= rails.length) return
    const next = [...rails];[next[i], next[j]] = [next[j], next[i]]; saveRails(next)
  }
  const toggleRail = (id: RailId) => saveRails(rails.map(r => r.id === id ? { ...r, on: !r.on } : r))
  const toggleAutoplay = () => {
    const v = !autoplay; setAutoplay(v)
    if (currentUser) api.users.savePrefs(currentUser.id, { autoplay_next: v }).catch(() => {})
  }

  // ── Lancements ─────────────────────────────────────────────────────────────
  const resumePlay = async (it: ProgressItem) => {
    if (!deviceId) { flash('Choisis un device', false); return }
    setLaunching(`resume:${it.media_key}`)
    try {
      const r = await api.play({
        plex_id: it.plex_id || undefined,
        iptv_stream_id: it.iptv_stream_id || undefined,
        iptv_type: (it.iptv_type as 'live' | 'vod' | 'series' | undefined) || undefined,
        iptv_ext: it.iptv_ext || undefined,
        title: it.title, thumb: it.thumb,
        resume_position_ms: it.position,
        app: it.plex_id ? 'plex' : 'iptv',
        device_id: deviceId, requester: 'manual',
      })
      flash(`⟲ ${r.title}`, true)
    } catch (e: any) { flash(`Échec : ${e.message}`, false) } finally { setLaunching(null) }
  }

  const onDeckPlay = async (it: PlexOnDeckItem) => {
    if (!deviceId) { flash('Choisis un device', false); return }
    setLaunching(`ondeck:${it.ratingKey}`)
    try {
      const title = `${it.grandparentTitle ?? it.title}${it.parentIndex != null && it.index != null ? ` — S${it.parentIndex}E${it.index}` : ''}`
      const r = await api.play({ plex_id: it.ratingKey, title, thumb: it.thumb, resume: (it.viewOffset ?? 0) > 0, app: 'plex', device_id: deviceId, requester: 'manual' })
      flash(`▶ ${r.title}`, true)
    } catch (e: any) { flash(`Échec : ${e.message}`, false) } finally { setLaunching(null) }
  }

  const launchFav = async (f: Favorite) => {
    if (f.app === 'iptv' && f.ref_type === 'series') { navigate('/catalog/iptv'); return }
    if (f.app === 'plex' && f.ref_type === 'show') { navigate('/catalog/plex'); return }
    if (f.app !== 'launchbox' && !deviceId) { flash('Choisis un device', false); return }
    setLaunching(`${f.app}:${f.ref_id}`)
    try {
      if (f.app === 'launchbox') {
        const r = await fetch('/api/launchbox/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(currentUser ? { 'X-User-Id': String(currentUser.id) } : {}) },
          body: JSON.stringify({ game_id: f.ref_id }),
        })
        if (!r.ok) throw new Error('échec du lancement')
        flash(`▶ ${f.title}`, true)
      } else if (f.app === 'iptv') {
        const r = await api.play({ iptv_stream_id: f.ref_id, iptv_type: (f.ref_type as any) ?? 'live', title: f.title, thumb: f.thumb, app: 'iptv', device_id: deviceId, requester: 'manual' })
        flash(`▶ ${r.title}`, true)
      } else if (f.app === 'plex') {
        const r = await api.play({ plex_id: f.ref_id, title: f.title, thumb: f.thumb, app: 'plex', device_id: deviceId, requester: 'manual' })
        flash(`▶ ${r.title}`, true)
      }
    } catch (e: any) { flash(`Échec : ${e.message}`, false) } finally { setLaunching(null) }
  }

  // ── Hero : le dernier média en cours, sinon le 1er « à suivre » Plex ────────
  const heroResume = resume[0]
  const heroOnDeck = !heroResume ? onDeck[0] : undefined
  const hero = heroResume
    ? { img: heroResume.thumb, kicker: 'Reprendre la lecture', title: heroResume.title ?? 'Lecture', percent: heroResume.percent, remain: heroResume.duration - heroResume.position, cta: 'Reprendre', action: () => resumePlay(heroResume) }
    : heroOnDeck
      ? { img: api.plex.imageUrl(heroOnDeck.thumb), kicker: 'À suivre sur Plex', title: `${heroOnDeck.grandparentTitle ?? heroOnDeck.title}${heroOnDeck.parentIndex != null && heroOnDeck.index != null ? ` · S${heroOnDeck.parentIndex}E${heroOnDeck.index}` : ''}`, percent: 0, remain: 0, cta: 'Regarder', action: () => onDeckPlay(heroOnDeck) }
      : null

  const enabled = rails.filter(r => r.on).map(r => r.id)

  return (
    <div className="space-y-7 max-w-6xl">
      {/* En-tête */}
      <div className="flex items-center gap-3 flex-wrap">
        {currentUser && (
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold text-black/80 shrink-0" style={{ backgroundColor: currentUser.avatar_color }}>
            {initials(currentUser.name)}
          </div>
        )}
        <h1 className="text-2xl font-light mr-auto">Bonjour <span className="font-semibold">{currentUser?.name}</span></h1>
        <select
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
          value={deviceId} onChange={e => setDeviceId(e.target.value)}
        >
          <option value="">— device —</option>
          {devices.map(d => <option key={d.id} value={d.id} disabled={!d.ws_connected}>{d.name} {d.ws_connected ? '' : '(offline)'}</option>)}
        </select>
        <button onClick={() => setEditing(true)} title="Personnaliser le dashboard"
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded text-zinc-500 hover:text-amber-400 transition-colors">
          <Settings2 size={18} />
        </button>
      </div>

      {/* Hero cinématique */}
      {hero && (
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 h-52 sm:h-64">
          {hero.img && <img src={hero.img} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40" />}
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/85 to-zinc-950/30" />
          <div className="relative h-full flex items-center gap-5 p-5 sm:p-7">
            {hero.img && (
              <img src={hero.img} alt={hero.title}
                className="hidden sm:block h-full aspect-[2/3] object-cover rounded-lg shadow-2xl shrink-0 ring-1 ring-white/10"
                onError={e => { e.currentTarget.style.display = 'none' }} />
            )}
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-amber-400 font-semibold mb-1.5">{hero.kicker}</div>
              <h2 className="text-2xl sm:text-3xl font-bold leading-tight line-clamp-2">{hero.title}</h2>
              {hero.percent > 0 && (
                <div className="mt-3 max-w-md">
                  <div className="h-1.5 bg-white/15 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${hero.percent}%` }} />
                  </div>
                  <div className="text-xs text-zinc-400 mt-1.5">Il te reste {fmt(hero.remain)}</div>
                </div>
              )}
              <button onClick={hero.action}
                className="mt-4 inline-flex items-center gap-2 px-5 min-h-11 rounded-full bg-amber-500 text-zinc-950 font-semibold hover:bg-amber-400 transition-colors">
                <Play size={16} fill="currentColor" /> {hero.cta}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rangées (ordre + visibilité selon les prefs du profil) */}
      {enabled.map(id => {
        if (id === 'resume') {
          if (!resume.length) return null
          return (
            <Rail key={id} icon={RotateCcw} title={RAIL_META.resume.label} count={resume.length}>
              {resume.map(it => {
                const busy = launching === `resume:${it.media_key}`
                return (
                  <button key={it.media_key} onClick={() => resumePlay(it)} disabled={busy}
                    className="group relative w-60 shrink-0 snap-start text-left disabled:opacity-50">
                    <div className="relative w-full aspect-video bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden group-hover:border-amber-500/60 transition-colors">
                      {it.thumb
                        ? <img src={it.thumb} alt={it.title ?? ''} loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                        : <div className="w-full h-full flex items-center justify-center text-zinc-700"><Film size={28} /></div>}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <div className="w-11 h-11 rounded-full bg-amber-500/90 text-zinc-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play size={18} fill="currentColor" />
                        </div>
                      </div>
                      <div className="absolute bottom-0 inset-x-0 h-1 bg-black/40">
                        <div className="h-full bg-amber-500" style={{ width: `${it.percent}%` }} />
                      </div>
                      {busy && <div className="absolute inset-0 bg-black/70 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-amber-400" /></div>}
                    </div>
                    <div className="text-sm mt-1.5 truncate">{it.title}</div>
                    <div className="text-[11px] text-zinc-500">{fmt(it.duration - it.position)} restantes</div>
                  </button>
                )
              })}
            </Rail>
          )
        }
        if (id === 'favorites') {
          return (
            <Rail key={id} icon={Heart} title={RAIL_META.favorites.label} count={favorites.length}>
              {favorites.length === 0 ? (
                <div className="text-sm text-zinc-600 py-6">Ajoute des chaînes, films ou jeux avec le ♥ dans le catalogue.</div>
              ) : favorites.map(f => {
                const Icon = APP_ICON[f.app] ?? Tv
                const busy = launching === `${f.app}:${f.ref_id}`
                const src = favImg(f)
                return (
                  <div key={`${f.app}:${f.ref_id}`} className="group relative w-32 shrink-0 snap-start">
                    <button onClick={() => launchFav(f)} disabled={busy}
                      className="w-full aspect-[2/3] bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50 block">
                      {src
                        ? <img src={src} alt={f.title ?? ''} loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                        : <div className="w-full h-full flex items-center justify-center text-zinc-700"><Icon size={26} /></div>}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                        <div className="text-xs font-medium line-clamp-2">{f.title}</div>
                        <div className="flex items-center gap-1 mt-1 text-amber-400 text-xs">
                          <Play size={11} fill="currentColor" /> {f.ref_type === 'series' || f.ref_type === 'show' ? 'Ouvrir' : 'Lancer'}
                        </div>
                      </div>
                      {busy && <div className="absolute inset-0 bg-black/70 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-amber-400" /></div>}
                      <div className="absolute top-1.5 left-1.5 bg-black/55 backdrop-blur-sm rounded p-1"><Icon size={12} className="text-white/90" /></div>
                    </button>
                    <button onClick={() => toggle(f)} title="Retirer des favoris"
                      className="tap-target reveal absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm hover:bg-black/75">
                      <Heart size={14} className="text-red-500" fill="currentColor" />
                    </button>
                  </div>
                )
              })}
            </Rail>
          )
        }
        if (id === 'ondeck') {
          if (!onDeck.length) return null
          return (
            <Rail key={id} icon={Film} title={RAIL_META.ondeck.label} count={onDeck.length}>
              {onDeck.map(it => {
                const busy = launching === `ondeck:${it.ratingKey}`
                return (
                  <button key={it.ratingKey} onClick={() => onDeckPlay(it)} disabled={busy}
                    className="group relative w-60 shrink-0 snap-start text-left disabled:opacity-50">
                    <div className="relative w-full aspect-video bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden group-hover:border-amber-500/60 transition-colors">
                      {it.thumb
                        ? <img src={api.plex.imageUrl(it.thumb)} alt={it.title} loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                        : <div className="w-full h-full flex items-center justify-center text-zinc-700"><Film size={28} /></div>}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <div className="w-11 h-11 rounded-full bg-amber-500/90 text-zinc-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play size={18} fill="currentColor" />
                        </div>
                      </div>
                      {(it.viewOffset ?? 0) > 0 && (it.duration ?? 0) > 0 && (
                        <div className="absolute bottom-0 inset-x-0 h-1 bg-black/40"><div className="h-full bg-amber-500" style={{ width: `${Math.min(100, Math.round((it.viewOffset! / it.duration!) * 100))}%` }} /></div>
                      )}
                      {busy && <div className="absolute inset-0 bg-black/70 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-amber-400" /></div>}
                    </div>
                    <div className="text-sm mt-1.5 truncate">{it.grandparentTitle ?? it.title}</div>
                    <div className="text-[11px] text-zinc-500">{it.parentIndex != null && it.index != null ? `S${it.parentIndex}E${it.index} · ` : ''}{it.title}</div>
                  </button>
                )
              })}
            </Rail>
          )
        }
        if (id === 'quick') {
          return (
            <section key={id}>
              <div className="flex items-center gap-2 mb-3">
                <MonitorPlay size={15} className="text-amber-400" />
                <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">{RAIL_META.quick.label}</h2>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {QUICK_TILES.map(t => (
                  <button key={t.to} onClick={() => navigate(t.to)}
                    className={`relative h-24 rounded-xl border border-zinc-800 bg-gradient-to-br ${t.grad} hover:border-amber-500/50 transition-colors flex flex-col items-start justify-end p-3 text-left group`}>
                    <t.icon size={22} className="absolute top-3 right-3 text-white/70 group-hover:text-white transition-colors" />
                    <span className="font-semibold">{t.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )
        }
        return null
      })}

      {/* Modale de personnalisation */}
      {editing && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setEditing(false)}>
          <div role="dialog" aria-label="Personnaliser le dashboard"
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="font-semibold">Personnaliser</h3>
              <button onClick={() => setEditing(false)} className="text-zinc-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">Rangées (ordre + visibilité)</div>
              {rails.map((r, i) => (
                <div key={r.id} className="flex items-center gap-2 bg-zinc-800/60 rounded-lg px-3 py-2">
                  <span className="flex-1 text-sm">{RAIL_META[r.id].label}</span>
                  <button onClick={() => moveRail(i, -1)} disabled={i === 0} aria-label="Monter"
                    className="w-8 h-8 inline-flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30"><ArrowUp size={15} /></button>
                  <button onClick={() => moveRail(i, 1)} disabled={i === rails.length - 1} aria-label="Descendre"
                    className="w-8 h-8 inline-flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30"><ArrowDown size={15} /></button>
                  <button onClick={() => toggleRail(r.id)} role="switch" aria-checked={r.on} aria-label={`Afficher ${RAIL_META[r.id].label}`}
                    className={`relative w-10 h-6 rounded-full transition-colors ${r.on ? 'bg-amber-500' : 'bg-zinc-600'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${r.on ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))}
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold pt-3 mb-1">Lecture</div>
              <div className="flex items-center gap-2 bg-zinc-800/60 rounded-lg px-3 py-2">
                <div className="flex-1">
                  <div className="text-sm">Épisode suivant auto</div>
                  <div className="text-[11px] text-zinc-500">Lance l'épisode suivant en fin de série (compte à rebours)</div>
                </div>
                <button onClick={toggleAutoplay} role="switch" aria-checked={autoplay} aria-label="Autoplay épisode suivant"
                  className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${autoplay ? 'bg-amber-500' : 'bg-zinc-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${autoplay ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  )
}
