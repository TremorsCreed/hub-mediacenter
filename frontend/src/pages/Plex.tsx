import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, Device, PlexItem, PlexOnDeckItem, PlexSection, PlexShowDetail } from '../api'
import { usePersistentDevice } from '../usePersistentDevice'
import { usePersistedState } from '../usePersistedState'
import { Search, Play, Loader2, AlertCircle, RotateCcw, ChevronLeft, ChevronRight, X, ChevronDown, Check, Film, Tv, Music, Image, Library } from 'lucide-react'
import FavoriteButton from '../components/FavoriteButton'
import AddToPlaylist from '../components/AddToPlaylist'
import { CatalogDndProvider, DraggableMedia } from '../components/CatalogDnd'

const SECTION_ICONS: Record<string, typeof Library> = {
  movie: Film,
  show: Tv,
  artist: Music,
  photo: Image,
}
const sectionIcon = (type: string) => SECTION_ICONS[type] ?? Library

const PAGE_SIZE = 60

function progressPct(it: { viewOffset?: number; duration?: number }): number {
  if (!it.viewOffset || !it.duration) return 0
  return Math.min(100, Math.max(0, (it.viewOffset / it.duration) * 100))
}

function fmtRemaining(it: { viewOffset?: number; duration?: number }): string {
  if (!it.viewOffset || !it.duration) return ''
  const remainMs = Math.max(0, it.duration - it.viewOffset)
  const min = Math.round(remainMs / 60000)
  return min < 60 ? `${min} min restantes` : `${Math.floor(min / 60)}h${(min % 60).toString().padStart(2, '0')}`
}

function OnDeckRow({ items, play, launching }: {
  items: PlexOnDeckItem[]
  play: (item: PlexItem, opts?: { resume?: boolean }) => void
  launching: string | null
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const refreshScrollState = () => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    refreshScrollState()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', refreshScrollState, { passive: true })
    const ro = new ResizeObserver(refreshScrollState)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', refreshScrollState); ro.disconnect() }
  }, [items.length])

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: 'smooth' })
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-2">
        <RotateCcw size={14} className="text-amber-400" />
        <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">Reprendre</h2>
        <span className="text-xs text-zinc-600">{items.length}</span>
      </div>
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-3 -mx-2 px-2 snap-x scroll-smooth scrollbar-thin"
          style={{ scrollbarWidth: 'thin' }}
        >
          {items.map(item => {
            const pct = progressPct(item)
            const subtitle = item.grandparentTitle
              ? `${item.grandparentTitle} · S${item.parentIndex ?? '?'}E${item.index ?? '?'}`
              : (item.year ? String(item.year) : '')
            return (
              <button
                key={`ondeck-${item.ratingKey}`}
                onClick={() => play(item, { resume: true })}
                disabled={launching === item.ratingKey}
                className="group relative shrink-0 w-[260px] aspect-[16/9] bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50 snap-start"
              >
                {item.thumb && (
                  <img src={api.plex.imageUrl(item.thumb)} alt={item.title} loading="lazy"
                       className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
                <div className="absolute inset-0 flex flex-col justify-end p-3">
                  <div className="text-sm font-semibold line-clamp-1">{item.title}</div>
                  {subtitle && <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">{subtitle}</div>}
                  <div className="text-[10px] text-amber-400 mt-1">{fmtRemaining(item)}</div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800/80">
                  <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                </div>
                {launching === item.ratingKey && (
                  <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                    <Loader2 size={22} className="animate-spin text-amber-400" />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {canLeft && (
          <button
            onClick={() => scrollBy(-1)}
            aria-label="Précédent"
            className="absolute left-0 top-0 bottom-3 w-12 flex items-center justify-center bg-gradient-to-r from-zinc-950/90 to-transparent hover:from-zinc-900 text-white transition-colors z-10"
          >
            <ChevronLeft size={28} strokeWidth={2.5} />
          </button>
        )}
        {canRight && (
          <button
            onClick={() => scrollBy(1)}
            aria-label="Suivant"
            className="absolute right-0 top-0 bottom-3 w-12 flex items-center justify-center bg-gradient-to-l from-zinc-950/90 to-transparent hover:from-zinc-900 text-white transition-colors z-10"
          >
            <ChevronRight size={28} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function Plex() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [sections, setSections] = useState<PlexSection[]>([])
  const [sectionId, setSectionId] = usePersistedState<string>('hub.plex.section', '')
  const [items, setItems] = useState<PlexItem[]>([])
  const [onDeck, setOnDeck] = useState<PlexOnDeckItem[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const fetchedRef = useRef(0)
  // Cascade : développée à l'entrée du module (la sidebar système, elle, se réduit)
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const { deviceId, setDeviceId, reconcile } = usePersistentDevice()
  const [sort, setSort] = usePersistedState('hub.plex.sort', 'titleSort') // tri natif Plex
  const [launching, setLaunching] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [selectedShow, setSelectedShow] = useState<PlexItem | null>(null)
  const [showDetail, setShowDetail] = useState<PlexShowDetail | null>(null)
  const [loadingShow, setLoadingShow] = useState(false)
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set([1]))

  useEffect(() => {
    api.plex.status().then(s => {
      setConnected(s.connected)
      if (s.connected) {
        api.plex.sections().then(setSections)
        api.plex.onDeck().then(setOnDeck).catch(() => {})
      }
    })
    api.devices.list().then(ds => {
      setDevices(ds)
      reconcile(ds)
    })
  }, [])

  useEffect(() => {
    // Garde la dernière section active (persistée) si elle existe encore, sinon
    // retombe sur la première.
    if (sections.length && !sections.some(s => s.id === sectionId)) setSectionId(sections[0].id)
  }, [sections])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // Chargement initial + reset quand les filtres changent
  useEffect(() => {
    if (!sectionId) return
    setLoading(true)
    setItems([])
    setTotal(0)
    fetchedRef.current = 0
    api.plex.sectionItems(sectionId, { start: 0, size: PAGE_SIZE, search: debouncedSearch || undefined, sort })
      .then(r => { setItems(r.items); setTotal(r.total); fetchedRef.current = r.items.length })
      .finally(() => setLoading(false))
  }, [sectionId, debouncedSearch, sort])

  // Charger la page suivante
  const hasMore = items.length < total
  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore || !sectionId) return
    const offset = fetchedRef.current
    setLoadingMore(true)
    api.plex.sectionItems(sectionId, { start: offset, size: PAGE_SIZE, search: debouncedSearch || undefined, sort })
      .then(r => { setItems(prev => [...prev, ...r.items]); fetchedRef.current = offset + r.items.length })
      .catch(console.error)
      .finally(() => setLoadingMore(false))
  }, [loadingMore, loading, hasMore, sectionId, debouncedSearch, sort])

  // IntersectionObserver sur le sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore() },
      { root: contentRef.current, rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  const play = async (item: PlexItem, opts: { resume?: boolean } = {}) => {
    // Series : ouvre la modale pour choisir l'épisode
    if (item.type === 'show') {
      openShow(item)
      return
    }
    if (!deviceId) {
      setToast({ msg: 'Sélectionne un device', ok: false })
      return
    }
    setLaunching(item.ratingKey)
    try {
      const r = await api.play({
        plex_id: item.ratingKey,
        title: item.title,
        thumb: item.thumb,
        resume: opts.resume,
        app: 'plex',
        device_id: deviceId,
        requester: 'manual',
      })
      setToast({ msg: `${opts.resume ? '⟲' : '▶'} ${r.title}`, ok: true })
    } catch (e: any) {
      setToast({ msg: `Échec : ${e.message}`, ok: false })
    } finally {
      setLaunching(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  const openShow = async (item: PlexItem) => {
    setSelectedShow(item)
    setShowDetail(null)
    setLoadingShow(true)
    try {
      const detail = await api.plex.show(item.ratingKey)
      setShowDetail(detail)
      // Ouvre par défaut la 1ère saison qui a un épisode non terminé, sinon S1
      const nextSeason = detail.seasons.find(s => s.viewed_count < s.episode_count)
      setOpenSeasons(new Set([nextSeason?.season_number ?? detail.seasons[0]?.season_number ?? 1]))
    } catch (e: any) {
      setToast({ msg: `Erreur : ${e.message}`, ok: false })
      setTimeout(() => setToast(null), 4000)
    } finally {
      setLoadingShow(false)
    }
  }

  const playEpisode = async (ep: { ratingKey: string; title: string; thumb?: string; viewOffset?: number }, season: number, epNum: number) => {
    if (!deviceId) { setToast({ msg: 'Sélectionne un device', ok: false }); return }
    setLaunching(`ep-${ep.ratingKey}`)
    const resume = (ep.viewOffset ?? 0) > 0
    try {
      const r = await api.play({
        plex_id: ep.ratingKey,
        title: `${selectedShow?.title} — S${season}E${epNum} ${ep.title}`,
        thumb: ep.thumb || selectedShow?.thumb,
        resume,
        app: 'plex',
        device_id: deviceId,
        requester: 'manual',
      })
      setToast({ msg: `${resume ? '⟲' : '▶'} ${r.title}`, ok: true })
      setSelectedShow(null)
    } catch (e: any) {
      setToast({ msg: `Échec : ${e.message}`, ok: false })
    } finally {
      setLaunching(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  const toggleSeason = (n: number) =>
    setOpenSeasons(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s })

  if (connected === false) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <AlertCircle size={32} />
          <div className="text-sm">Plex n'est pas connecté.</div>
          <a href="/admin/settings" className="text-amber-400 hover:text-amber-300 text-sm underline">Aller dans Settings</a>
        </div>
      </div>
    )
  }

  return (
    <CatalogDndProvider>
    <div className="flex h-full">

      {/* ── Sidebar bibliothèques (collapsible) ───────────────────── */}
      <aside
        className={`${sectionsCollapsed ? 'w-14 cursor-pointer' : 'w-52'} shrink-0 bg-zinc-950/60 border-r border-zinc-800 flex flex-col transition-[width] duration-200 overflow-hidden`}
        // Vue élargie d'un simple clic n'importe où sur la sidebar réduite
        onClick={e => {
          if (sectionsCollapsed && !(e.target as HTMLElement).closest('button')) setSectionsCollapsed(false)
        }}
      >
        <div className="h-[53px] shrink-0 border-b border-zinc-800 flex items-center px-3">
          {sectionsCollapsed
            ? <Library size={16} strokeWidth={1.8} className="mx-auto text-zinc-500" />
            : <span className="text-sm font-semibold text-white truncate">Plex</span>
          }
        </div>
        <nav className="flex-1 py-1 overflow-y-auto">
          {sections.map(s => {
            const Icon = sectionIcon(s.type)
            return (
              <button
                key={s.id}
                onClick={() => setSectionId(s.id)}
                title={sectionsCollapsed ? s.title : undefined}
                className={`w-full flex items-center py-3 text-sm transition-colors text-left border-l-2 ${
                  sectionsCollapsed ? 'justify-center px-0' : 'gap-2.5 px-4'
                } ${
                  sectionId === s.id
                    ? 'bg-zinc-800 text-white border-amber-500'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
                }`}
              >
                <Icon size={15} strokeWidth={1.8} />
                {!sectionsCollapsed && <span className="truncate">{s.title}</span>}
              </button>
            )
          })}
        </nav>
        <div className="h-[45px] shrink-0 border-t border-zinc-800 flex items-center px-3">
          <button
            onClick={() => setSectionsCollapsed(v => !v)}
            title={sectionsCollapsed ? 'Agrandir' : 'Réduire'}
            className={`text-zinc-600 hover:text-zinc-300 transition-colors ${sectionsCollapsed ? 'mx-auto' : 'ml-auto'}`}
          >
            {sectionsCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </aside>

      {/* ── Zone de contenu ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Barre de contrôles */}
        <div className="flex items-center gap-2 px-4 min-h-[53px] border-b border-zinc-800 shrink-0 flex-wrap">
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

          {/* Tri (natif Plex, appliqué côté serveur) */}
          <select
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
            value={sort}
            onChange={e => setSort(e.target.value)}
            title="Tri"
          >
            <option value="titleSort">Titre A → Z</option>
            <option value="titleSort:desc">Titre Z → A</option>
            <option value="addedAt:desc">Ajoutés récemment</option>
            <option value="year:desc">Année (récent d'abord)</option>
            <option value="year">Année (ancien d'abord)</option>
            <option value="rating:desc">Note</option>
            <option value="lastViewedAt:desc">Vus récemment</option>
          </select>

          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 pl-8 text-sm focus:outline-none focus:border-zinc-600"
              placeholder="Rechercher dans la bibliothèque…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Contenu scrollable */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4 space-y-4">

      {loading && items.length === 0 && (
        <div className="flex items-center justify-center py-16 text-zinc-600 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Chargement…
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-zinc-600 py-16 text-center">Aucun résultat.</div>
      )}

      {/* En cours (onDeck) : visible quand on est sur la section courante */}
      {onDeck.length > 0 && !debouncedSearch && (
        <OnDeckRow items={onDeck} play={play} launching={launching} />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {items.map(item => {
          const inProgress = (item.viewOffset ?? 0) > 0
          const pct = progressPct(item)
          return (
            <DraggableMedia
              key={item.ratingKey}
              id={`plex-${item.ratingKey}`}
              item={{ app: 'plex', ref_id: item.ratingKey, ref_type: item.type, title: item.title, year: item.year, thumb: item.thumb }}
              className="relative group"
            >
              <button
                onClick={() => play(item, { resume: inProgress })}
                disabled={launching === item.ratingKey}
                className="relative aspect-[2/3] w-full bg-zinc-900 border border-zinc-800 rounded overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50 block"
              >
                {item.thumb ? (
                  <img src={api.plex.imageUrl(item.thumb)} alt={item.title} loading="lazy"
                       className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs p-2 text-center">{item.title}</div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                  <div className="text-xs font-medium line-clamp-2">{item.title}</div>
                  {item.year && <div className="text-[10px] text-zinc-400 mt-0.5">{item.year}</div>}
                  <div className="flex items-center gap-1 mt-1.5 text-amber-400 text-xs">
                    {inProgress ? <><RotateCcw size={10} /> Reprendre</> : <><Play size={11} fill="currentColor" /> Lancer</>}
                  </div>
                </div>

                {inProgress && pct > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/70">
                    <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                )}

                {launching === item.ratingKey && (
                  <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-amber-400" />
                  </div>
                )}
              </button>

              <FavoriteButton
                fav={{ app: 'plex', ref_id: item.ratingKey, ref_type: item.type, title: item.title, thumb: item.thumb }}
                className="absolute top-1.5 left-1.5 z-10 w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity"
              />
              <AddToPlaylist
                item={{ app: 'plex', ref_id: item.ratingKey, ref_type: item.type, title: item.title, year: item.year, thumb: item.thumb }}
                className="absolute top-1.5 left-10 z-10 w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity"
              />

              {/* Mini bouton "recommencer du début" sur les en-cours (visible au hover) */}
              {inProgress && (
                <button
                  onClick={() => play(item, { resume: false })}
                  disabled={launching === item.ratingKey}
                  className="absolute top-1.5 right-1.5 z-10 opacity-0 hover:opacity-100 group-hover:opacity-100 bg-zinc-900/90 border border-zinc-700 hover:border-amber-500/60 text-amber-400 rounded px-1.5 py-1 text-[10px] flex items-center gap-1 transition-opacity"
                  title="Recommencer du début"
                >
                  <Play size={9} fill="currentColor" />
                </button>
              )}
            </DraggableMedia>
          )
        })}
      </div>

          {/* Sentinel scroll infini */}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-4 text-zinc-600 gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Modale détail série Plex */}
      {selectedShow && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setSelectedShow(null)}
        >
          <div className="bg-zinc-900/95 border border-zinc-700 rounded-lg max-w-3xl w-full my-8 relative shadow-2xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedShow(null)} className="absolute top-3 right-3 text-zinc-500 hover:text-white z-10">
              <X size={18} />
            </button>

            <div className="p-5 border-b border-zinc-800">
              <div className="flex gap-4">
                {(showDetail?.info.thumb || selectedShow.thumb) && (
                  <img
                    src={api.plex.imageUrl(showDetail?.info.thumb || selectedShow.thumb)}
                    alt={selectedShow.title}
                    className="w-28 h-40 object-cover rounded shrink-0 bg-zinc-800"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold leading-tight">{showDetail?.info.title ?? selectedShow.title}</h2>
                  <div className="text-xs text-zinc-500 mt-1 flex gap-3 flex-wrap items-center">
                    {showDetail?.info.year && <span>{showDetail.info.year}</span>}
                    {showDetail?.info.rating && <span>★ {showDetail.info.rating.toFixed(1)}</span>}
                    {showDetail && showDetail.info.leafCount > 0 && (
                      <span>{showDetail.info.viewedLeafCount}/{showDetail.info.leafCount} épisodes vus</span>
                    )}
                  </div>
                  {showDetail?.info.summary && (
                    <p className="text-sm text-zinc-300 mt-3 line-clamp-4">{showDetail.info.summary}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-5">
              {loadingShow && (
                <div className="flex items-center justify-center py-8 text-zinc-500 gap-2 text-sm">
                  <Loader2 size={14} className="animate-spin" /> Chargement des épisodes…
                </div>
              )}
              {!loadingShow && showDetail && showDetail.seasons.length === 0 && (
                <div className="text-sm text-zinc-600 py-6 text-center">Aucune saison trouvée.</div>
              )}
              {!loadingShow && showDetail?.seasons.map(season => {
                const isOpen = openSeasons.has(season.season_number)
                const allViewed = season.viewed_count >= season.episode_count
                return (
                  <div key={season.ratingKey} className="border-t border-zinc-800 first:border-t-0">
                    <DraggableMedia
                      id={`plex-season-${season.ratingKey}`}
                      items={season.episodes.map(ep => ({ app: 'plex', ref_id: ep.ratingKey, ref_type: 'episode', title: `${selectedShow?.title} — S${season.season_number}E${ep.episode_number} ${ep.title}`, thumb: ep.thumb || selectedShow?.thumb }))}
                      label={`${season.title} (${season.episode_count} ép.)`}
                    >
                      <button
                        onClick={() => toggleSeason(season.season_number)}
                        className="w-full flex items-center gap-2 py-3 text-left hover:text-amber-400 transition-colors"
                      >
                        <ChevronDown size={16} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                        <span className="font-medium">{season.title}</span>
                        <span className="text-xs text-zinc-500">
                          · {season.viewed_count}/{season.episode_count}
                        </span>
                        {allViewed && <Check size={12} className="text-green-500 ml-1" />}
                      </button>
                    </DraggableMedia>
                    {isOpen && (
                      <div className="space-y-1 pb-3">
                        {season.episodes.map(ep => {
                          const busy = launching === `ep-${ep.ratingKey}`
                          const inProgress = (ep.viewOffset ?? 0) > 0
                          const seen = (ep.viewCount ?? 0) > 0
                          const pct = inProgress && ep.duration
                            ? Math.min(100, Math.max(0, (ep.viewOffset! / ep.duration) * 100))
                            : 0
                          return (
                            <DraggableMedia
                              key={ep.ratingKey}
                              id={`plex-ep-${ep.ratingKey}`}
                              item={{ app: 'plex', ref_id: ep.ratingKey, ref_type: 'episode', title: `${selectedShow?.title} — S${season.season_number}E${ep.episode_number} ${ep.title}`, thumb: ep.thumb || selectedShow?.thumb }}
                            >
                            <button
                              onClick={() => playEpisode(ep, season.season_number, ep.episode_number)}
                              disabled={busy}
                              className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-zinc-800 text-left disabled:opacity-50 transition-colors group"
                            >
                              <div className="text-xs text-zinc-500 w-12 shrink-0">
                                S{season.season_number}E{ep.episode_number}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate flex items-center gap-1.5">
                                  {ep.title}
                                  {seen && !inProgress && <Check size={10} className="text-green-500" />}
                                </div>
                                {(ep.air_date || inProgress) && (
                                  <div className="text-[11px] text-zinc-600 flex items-center gap-2">
                                    {ep.air_date && <span>{ep.air_date.slice(0, 10)}</span>}
                                    {inProgress && <span className="text-amber-400">En cours · {Math.round(pct)}%</span>}
                                  </div>
                                )}
                                {inProgress && pct > 0 && (
                                  <div className="h-0.5 bg-zinc-800 mt-1 rounded">
                                    <div className="h-full bg-amber-400 rounded" style={{ width: `${pct}%` }} />
                                  </div>
                                )}
                              </div>
                              {busy
                                ? <Loader2 size={14} className="animate-spin text-amber-400" />
                                : inProgress
                                  ? <RotateCcw size={12} className="text-amber-400" />
                                  : <Play size={12} className="text-zinc-600 group-hover:text-amber-400" fill="currentColor" />
                              }
                            </button>
                            </DraggableMedia>
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
    </CatalogDndProvider>
  )
}
