import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, Device, IptvCategory, IptvSeriesInfo, IptvStream } from '../api'
import { Search, Play, Loader2, AlertCircle, Tv, Film, Languages, MonitorPlay, X, ChevronDown, ChevronRight } from 'lucide-react'

const PAGE_SIZE = 300

const LANG_PREFS_KEY = 'iptv.languages.selected'
const COMMON_LANG_LABELS: Record<string, string> = {
  FR: 'Français', EN: 'English', DE: 'Deutsch', ES: 'Español', IT: 'Italiano',
  NL: 'Nederlands', PT: 'Português', RU: 'Русский', TR: 'Türkçe', AR: 'العربية',
  PL: 'Polski', GR: 'Ελληνικά', RO: 'Română', HU: 'Magyar', CZ: 'Čeština',
  JP: '日本語', KO: '한국어', CN: '中文', MULTI: 'Multi',
  '??': 'Inconnu',
}

const MEDIA_TYPES = [
  { key: 'live' as const, label: 'TV', icon: Tv },
  { key: 'vod' as const, label: 'Films', icon: Film },
  { key: 'series' as const, label: 'Séries', icon: MonitorPlay },
]

export default function Iptv() {
  const [creds, setCreds] = useState<{ id: number; name: string }[]>([])
  const [credId, setCredId] = useState<number | null>(null)
  const [type, setType] = useState<'live' | 'vod' | 'series'>('live')
  const [selectedSeries, setSelectedSeries] = useState<IptvStream | null>(null)
  const [seriesInfo, setSeriesInfo] = useState<IptvSeriesInfo | null>(null)
  const [loadingSeries, setLoadingSeries] = useState(false)
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set([1]))
  const [categories, setCategories] = useState<IptvCategory[]>([])
  const [categoryId, setCategoryId] = useState<string>('')
  const [streams, setStreams] = useState<IptvStream[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const fetchedRef = useRef(0)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [launching, setLaunching] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [availableLangs, setAvailableLangs] = useState<{ code: string; count: number }[]>([])
  const [selectedLangs, setSelectedLangs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(LANG_PREFS_KEY) ?? '["FR","EN"]') } catch { return ['FR', 'EN'] }
  })
  const [langPanelOpen, setLangPanelOpen] = useState(false)

  useEffect(() => {
    api.iptv.credentials().then(c => {
      setCreds(c)
      if (c.length) setCredId(c[0].id)
    })
    api.devices.list().then(ds => {
      setDevices(ds)
      const connectedDev = ds.find(d => d.ws_connected)
      if (connectedDev) setDeviceId(connectedDev.id)
    })
  }, [])

  useEffect(() => {
    if (!credId) return
    setCategoryId('')
    api.iptv.categories(credId, type).then(setCategories).catch(() => setCategories([]))
    api.iptv.languages(credId, type).then(setAvailableLangs).catch(() => setAvailableLangs([]))
  }, [credId, type])

  useEffect(() => {
    localStorage.setItem(LANG_PREFS_KEY, JSON.stringify(selectedLangs))
  }, [selectedLangs])

  const toggleLang = (code: string) => {
    setSelectedLangs(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!credId) return
    setLoading(true)
    fetchedRef.current = 0
    api.iptv.streams(credId, {
      type,
      category: categoryId || undefined,
      search: debouncedSearch || undefined,
      languages: selectedLangs.length > 0 ? selectedLangs : undefined,
      start: 0,
      limit: PAGE_SIZE,
    })
      .then(r => {
        setStreams(r.items)
        setTotal(r.total)
        fetchedRef.current = r.items.length
      })
      .catch(() => { setStreams([]); setTotal(0); fetchedRef.current = 0 })
      .finally(() => setLoading(false))
  }, [credId, type, categoryId, debouncedSearch, selectedLangs])

  const loadMore = async () => {
    if (!credId || loadingMore || loading) return
    if (fetchedRef.current >= total) return
    setLoadingMore(true)
    try {
      const r = await api.iptv.streams(credId, {
        type,
        category: categoryId || undefined,
        search: debouncedSearch || undefined,
        languages: selectedLangs.length > 0 ? selectedLangs : undefined,
        start: fetchedRef.current,
        limit: PAGE_SIZE,
      })
      setStreams(prev => [...prev, ...r.items])
      fetchedRef.current += r.items.length
      setTotal(r.total)
    } catch { /* silent */ }
    finally { setLoadingMore(false) }
  }

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore()
    }, { root: contentRef.current, rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [credId, type, categoryId, debouncedSearch, selectedLangs, total, loadingMore, loading])

  const play = async (s: IptvStream) => {
    if (s.type === 'series') {
      openSeries(s)
      return
    }
    if (!deviceId) {
      setToast({ msg: 'Sélectionne un device', ok: false })
      return
    }
    setLaunching(s.stream_id)
    try {
      const r = await api.play({
        iptv_stream_id: s.stream_id,
        iptv_type: s.type,
        title: s.name,
        thumb: s.logo,
        app: 'iptv',
        device_id: deviceId,
        requester: 'manual',
      })
      setToast({ msg: `▶ ${r.title}`, ok: true })
    } catch (e: any) {
      setToast({ msg: `Échec : ${e.message}`, ok: false })
    } finally {
      setLaunching(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  const openSeries = async (s: IptvStream) => {
    setSelectedSeries(s)
    setSeriesInfo(null)
    setLoadingSeries(true)
    setOpenSeasons(new Set([1]))
    try {
      const info = await api.iptv.seriesInfo(credId!, s.stream_id)
      setSeriesInfo(info)
    } catch (e: any) {
      setToast({ msg: `Erreur série : ${e.message}`, ok: false })
      setTimeout(() => setToast(null), 4000)
    } finally {
      setLoadingSeries(false)
    }
  }

  const playEpisode = async (episodeId: string, ext: string, title: string) => {
    if (!deviceId) { setToast({ msg: 'Sélectionne un device', ok: false }); return }
    setLaunching(`ep-${episodeId}`)
    try {
      const r = await api.play({
        iptv_stream_id: episodeId,
        iptv_type: 'series',
        iptv_ext: ext,
        title,
        thumb: selectedSeries?.logo,
        app: 'iptv',
        device_id: deviceId,
        requester: 'manual',
      })
      setToast({ msg: `▶ ${r.title}`, ok: true })
      setSelectedSeries(null)
    } catch (e: any) {
      setToast({ msg: `Échec : ${e.message}`, ok: false })
    } finally {
      setLaunching(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  const toggleSeason = (n: number) =>
    setOpenSeasons(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s })

  if (creds.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <AlertCircle size={32} />
          <div className="text-sm">Aucun profil IPTV.</div>
          <a href="/credentials" className="text-amber-400 hover:text-amber-300 text-sm underline">Créer un profil Xtream</a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">

      {/* ── Sidebar type de média ─────────────────────────────────── */}
      <aside className="w-36 shrink-0 bg-zinc-950/60 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
          <span className="text-sm font-semibold text-white">IPTV</span>
        </div>
        <nav className="py-1">
          {MEDIA_TYPES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setType(key); setCategoryId('') }}
              className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm transition-colors text-left border-l-2 ${
                type === key
                  ? 'bg-zinc-800 text-white border-amber-500'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
              }`}
            >
              <Icon size={15} strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Sidebar catégories (TV / Films / Séries) ──────────────── */}
      <aside className="w-48 shrink-0 bg-zinc-950/40 border-r border-zinc-800 flex flex-col">
        <div className="px-3 py-3 border-b border-zinc-800 text-[10px] uppercase tracking-widest text-zinc-600 font-medium shrink-0">
          Catégories
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          <button
            onClick={() => setCategoryId('')}
            className={`w-full px-3 py-2 text-xs text-left transition-colors truncate ${
              categoryId === ''
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            Toutes les catégories
          </button>
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`w-full px-3 py-2 text-xs text-left transition-colors truncate ${
                categoryId === c.id
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Zone de contenu ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Barre de contrôles */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 shrink-0 flex-wrap">
          <select
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
            value={credId ?? ''}
            onChange={e => setCredId(Number(e.target.value))}
          >
            {creds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <select
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
            value={deviceId}
            onChange={e => setDeviceId(e.target.value)}
          >
            <option value="">— device —</option>
            {devices.map(d => (
              <option key={d.id} value={d.id} disabled={!d.ws_connected}>
                {d.name} {d.ws_connected ? '' : '(offline)'}
              </option>
            ))}
          </select>

          {/* Filtre langues */}
          <div className="relative">
            <button
              onClick={() => setLangPanelOpen(v => !v)}
              className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600"
            >
              <Languages size={13} />
              {selectedLangs.length === 0
                ? 'Toutes les langues'
                : selectedLangs.length <= 3
                  ? selectedLangs.map(c => COMMON_LANG_LABELS[c]?.slice(0, 2) ?? c).join(' · ')
                  : `${selectedLangs.length} langues`}
            </button>
            {langPanelOpen && (
              <div className="absolute z-20 top-full mt-1 left-0 w-72 max-h-96 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2">
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-xs text-zinc-500 uppercase tracking-widest">Langues</span>
                  <button onClick={() => setSelectedLangs([])} className="text-xs text-zinc-500 hover:text-amber-400">Tout</button>
                </div>
                {availableLangs.length === 0 && <div className="text-xs text-zinc-600 p-2">Aucune langue détectée</div>}
                {availableLangs.map(({ code, count }) => {
                  const checked = selectedLangs.includes(code)
                  const label = COMMON_LANG_LABELS[code] ?? code
                  return (
                    <label key={code} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-amber-500"
                        checked={checked}
                        onChange={() => toggleLang(code)}
                      />
                      <span className="text-sm text-zinc-200 flex-1">{label}</span>
                      <span className="text-xs text-zinc-500">{count.toLocaleString()}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recherche */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 pl-8 text-sm focus:outline-none focus:border-zinc-600"
              placeholder={type === 'live' ? 'Rechercher une chaîne…' : type === 'series' ? 'Rechercher une série…' : 'Rechercher un film…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {!loading && total > 0 && (
            <span className="text-xs text-zinc-500 shrink-0">{total.toLocaleString()} résultats</span>
          )}
        </div>

        {/* Grille de streams */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
          {loading && streams.length === 0 && (
            <div className="flex items-center justify-center py-16 text-zinc-600 gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Chargement…
            </div>
          )}

          {!loading && streams.length === 0 && (
            <div className="text-sm text-zinc-600 py-16 text-center">Aucun résultat.</div>
          )}

          {type === 'live' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
              {streams.map(s => (
                <button
                  key={s.stream_id}
                  onClick={() => play(s)}
                  disabled={launching === s.stream_id}
                  className="group flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded p-2 hover:border-amber-500/60 transition-colors text-left disabled:opacity-50"
                >
                  <div className="w-12 h-12 shrink-0 bg-zinc-800 rounded overflow-hidden flex items-center justify-center">
                    {s.logo ? (
                      <img src={api.iptv.imageUrl(s.logo)} alt="" loading="lazy" className="w-full h-full object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />
                    ) : (
                      <Tv size={18} className="text-zinc-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{s.name}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">Live · #{s.stream_id}</div>
                  </div>
                  {launching === s.stream_id
                    ? <Loader2 size={14} className="animate-spin text-amber-400" />
                    : <Play size={12} className="text-zinc-600 group-hover:text-amber-400 transition-colors" fill="currentColor" />
                  }
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {streams.map(s => (
                <button
                  key={s.stream_id}
                  onClick={() => play(s)}
                  disabled={launching === s.stream_id}
                  className="group relative aspect-[2/3] bg-zinc-900 border border-zinc-800 rounded overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50"
                >
                  {s.logo ? (
                    <img src={api.iptv.imageUrl(s.logo)} alt={s.name} loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs p-2 text-center">{s.name}</div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                    <div className="text-xs font-medium line-clamp-2">{s.name}</div>
                    {s.year && <div className="text-[10px] text-zinc-400 mt-0.5">{s.year}</div>}
                    <div className="flex items-center gap-1 mt-1.5 text-amber-400 text-xs">
                      <Play size={11} fill="currentColor" /> Lancer
                    </div>
                  </div>
                  {launching === s.stream_id && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                      <Loader2 size={20} className="animate-spin text-amber-400" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {streams.length < total && (
            <div ref={sentinelRef} className="flex items-center justify-center py-6 text-xs text-zinc-500 gap-2">
              {loadingMore
                ? <><Loader2 size={14} className="animate-spin" /> Chargement…</>
                : `${streams.length.toLocaleString()} / ${total.toLocaleString()}`}
            </div>
          )}
          {streams.length > 0 && streams.length >= total && (
            <div className="text-xs text-zinc-600 text-center pt-3 pb-1">
              {total.toLocaleString()} résultat{total > 1 ? 's' : ''} — fin de liste
            </div>
          )}
        </div>
      </div>

      {/* ── Modale série ─────────────────────────────────────────── */}
      {selectedSeries && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setSelectedSeries(null)}
        >
          <div className="bg-zinc-900/95 border border-zinc-700 rounded-lg max-w-3xl w-full my-8 relative shadow-2xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedSeries(null)} className="absolute top-3 right-3 text-zinc-500 hover:text-white z-10">
              <X size={18} />
            </button>

            <div className="p-5 border-b border-zinc-800">
              <div className="flex gap-4">
                {(seriesInfo?.info.cover || selectedSeries.logo) && (
                  <img
                    src={api.iptv.imageUrl(seriesInfo?.info.cover || selectedSeries.logo)}
                    alt={selectedSeries.name}
                    className="w-28 h-40 object-cover rounded shrink-0 bg-zinc-800"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold leading-tight">{seriesInfo?.info.name ?? selectedSeries.name}</h2>
                  <div className="text-xs text-zinc-500 mt-1 flex gap-3 flex-wrap">
                    {seriesInfo?.info.release_date && <span>{seriesInfo.info.release_date.slice(0, 4)}</span>}
                    {seriesInfo?.info.genre && <span>{seriesInfo.info.genre}</span>}
                    {seriesInfo?.info.rating && <span>★ {seriesInfo.info.rating}</span>}
                  </div>
                  {seriesInfo?.info.plot && (
                    <p className="text-sm text-zinc-300 mt-3 line-clamp-4">{seriesInfo.info.plot}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-5">
              {loadingSeries && (
                <div className="flex items-center justify-center py-8 text-zinc-500 gap-2 text-sm">
                  <Loader2 size={14} className="animate-spin" /> Chargement des épisodes…
                </div>
              )}
              {!loadingSeries && seriesInfo && seriesInfo.seasons.length === 0 && (
                <div className="text-sm text-zinc-600 py-6 text-center">Aucun épisode disponible.</div>
              )}
              {!loadingSeries && seriesInfo?.seasons.map(season => {
                const isOpen = openSeasons.has(season.season_number)
                return (
                  <div key={season.season_number} className="border-t border-zinc-800 first:border-t-0">
                    <button
                      onClick={() => toggleSeason(season.season_number)}
                      className="w-full flex items-center gap-2 py-3 text-left hover:text-amber-400 transition-colors"
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="font-medium">{season.name}</span>
                      <span className="text-xs text-zinc-500">· {season.episode_count} épisode{season.episode_count > 1 ? 's' : ''}</span>
                    </button>
                    {isOpen && (
                      <div className="space-y-1 pb-3">
                        {season.episodes.map(ep => {
                          const busy = launching === `ep-${ep.episode_id}`
                          return (
                            <button
                              key={ep.episode_id}
                              onClick={() => playEpisode(ep.episode_id, ep.container_extension, `${selectedSeries.name} — S${season.season_number}E${ep.episode_num} ${ep.title}`)}
                              disabled={busy}
                              className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-zinc-800 text-left disabled:opacity-50 transition-colors"
                            >
                              <div className="text-xs text-zinc-500 w-12 shrink-0">S{season.season_number}E{ep.episode_num}</div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">{ep.title}</div>
                                {ep.air_date && <div className="text-[11px] text-zinc-600">{ep.air_date}</div>}
                              </div>
                              {busy ? <Loader2 size={14} className="animate-spin text-amber-400" /> : <Play size={12} className="text-zinc-600" fill="currentColor" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {toast && createPortal(
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded shadow-lg text-sm font-medium z-[110] ${
          toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>,
        document.body
      )}
    </div>
  )
}
