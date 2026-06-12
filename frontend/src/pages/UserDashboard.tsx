import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, Device, Favorite, HistoryEntry } from '../api'
import { usePersistentDevice } from '../usePersistentDevice'
import { useUser, initials } from '../UserContext'
import { useFavorites } from '../FavoritesContext'
import { Heart, Play, Loader2, Tv, Film, Gamepad2, MonitorPlay, Radio, History as HistoryIcon } from 'lucide-react'

const APP_ICON: Record<string, typeof Tv> = { iptv: Radio, plex: Film, launchbox: Gamepad2, catalog: MonitorPlay }

function favImg(f: Favorite): string {
  if (!f.thumb) return ''
  if (f.app === 'launchbox') return f.thumb
  if (f.app === 'plex') return api.plex.imageUrl(f.thumb)
  return api.iptv.imageUrl(f.thumb) // iptv (logo/URL)
}

export default function UserDashboard() {
  const { currentUser, adminUnlocked } = useUser()
  const { favorites, toggle } = useFavorites()
  const navigate = useNavigate()
  const [devices, setDevices] = useState<Device[]>([])
  const { deviceId, setDeviceId, reconcile } = usePersistentDevice()
  const [recent, setRecent] = useState<HistoryEntry[]>([])
  const [launching, setLaunching] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    api.devices.list().then(ds => {
      setDevices(ds)
      reconcile(ds)
    })
  }, [])

  useEffect(() => {
    if (!currentUser) return
    api.state.history(adminUnlocked ? String(currentUser.id) : undefined).then(h => setRecent(h.slice(0, 8))).catch(() => {})
  }, [currentUser, adminUnlocked])

  const flash = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  const launch = async (f: Favorite) => {
    // Séries / shows : sélection d'épisode nécessaire → on ouvre le module concerné.
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
    } catch (e: any) {
      flash(`Échec : ${e.message}`, false)
    } finally {
      setLaunching(null)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
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
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
        >
          <option value="">— device —</option>
          {devices.map(d => (
            <option key={d.id} value={d.id} disabled={!d.ws_connected}>{d.name} {d.ws_connected ? '' : '(offline)'}</option>
          ))}
        </select>
      </div>

      {/* Favoris */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Heart size={15} className="text-red-500" fill="currentColor" />
          <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">Mes favoris</h2>
          <span className="text-xs text-zinc-600">{favorites.length}</span>
        </div>

        {favorites.length === 0 ? (
          <div className="text-sm text-zinc-600 bg-zinc-900/50 border border-zinc-800 rounded-lg py-10 text-center">
            Aucun favori pour l'instant. Ajoute des chaînes, films ou jeux avec le <Heart size={12} className="inline text-red-500 mx-0.5" fill="currentColor" /> dans le catalogue.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {favorites.map(f => {
              const Icon = APP_ICON[f.app] ?? Tv
              const busy = launching === `${f.app}:${f.ref_id}`
              const src = favImg(f)
              return (
                <div key={`${f.app}:${f.ref_id}`} className="group relative">
                  <button
                    onClick={() => launch(f)}
                    disabled={busy}
                    className="w-full aspect-[2/3] bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50 block"
                  >
                    {src
                      ? <img src={src} alt={f.title ?? ''} loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                      : <div className="w-full h-full flex items-center justify-center text-zinc-700"><Icon size={28} /></div>}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                      <div className="text-xs font-medium line-clamp-2">{f.title}</div>
                      <div className="flex items-center gap-1 mt-1 text-amber-400 text-xs">
                        <Play size={11} fill="currentColor" /> {f.ref_type === 'series' || f.ref_type === 'show' ? 'Ouvrir' : 'Lancer'}
                      </div>
                    </div>
                    {busy && <div className="absolute inset-0 bg-black/70 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-amber-400" /></div>}
                    <div className="absolute top-1.5 left-1.5 bg-black/55 backdrop-blur-sm rounded p-1"><Icon size={12} className="text-white/90" /></div>
                  </button>
                  <button
                    onClick={() => toggle(f)}
                    title="Retirer des favoris"
                    className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm hover:bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Heart size={14} className="text-red-500" fill="currentColor" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Repris récemment */}
      {recent.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <HistoryIcon size={15} className="text-zinc-400" />
            <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">Repris récemment</h2>
          </div>
          <div className="space-y-1.5">
            {recent.map(h => (
              <div key={h.id} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{h.title ?? 'Inconnu'}</div>
                  <div className="text-xs text-zinc-500">{h.device_name ?? h.device_id} · {h.app}</div>
                </div>
                <div className="text-xs text-zinc-600 shrink-0">{new Date(h.started_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded shadow-lg text-sm font-medium z-[110] ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
