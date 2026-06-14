import { useCallback, useEffect, useRef, useState } from 'react'
import { Gamepad2, Search, RefreshCw, Play, Loader2, AlertCircle, RotateCcw, Library, ChevronLeft, ChevronRight } from 'lucide-react'
import FavoriteButton from '../components/FavoriteButton'
import AddToPlaylist from '../components/AddToPlaylist'
import { CatalogDndProvider, DraggableMedia } from '../components/CatalogDnd'
import { usePersistedState } from '../usePersistedState'

const BASE = '/api/launchbox'

interface LbGame {
  id: string
  title: string
  platform: string
  publisher: string
}

interface GamesPage {
  total: number
  start: number
  size: number
  items: LbGame[]
}

async function fetchPlatforms(): Promise<string[]> {
  const r = await fetch(`${BASE}/platforms`)
  if (!r.ok) throw new Error('Impossible de charger les plateformes')
  return r.json()
}

async function fetchGames(opts: {
  platform?: string
  q?: string
  start?: number
  limit?: number
  sort?: string
}): Promise<GamesPage> {
  const p = new URLSearchParams()
  if (opts.platform) p.set('platform', opts.platform)
  if (opts.q) p.set('q', opts.q)
  if (opts.start !== undefined) p.set('start', String(opts.start))
  if (opts.limit) p.set('limit', String(opts.limit))
  if (opts.sort) p.set('sort', opts.sort)
  const r = await fetch(`${BASE}/games?${p}`)
  if (!r.ok) throw new Error('Impossible de charger les jeux')
  return r.json()
}

async function launchGame(gameId: string): Promise<{ ok: boolean; title: string }> {
  const r = await fetch(`${BASE}/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game_id: gameId })
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j.error ?? `HTTP ${r.status}`)
  }
  return r.json()
}

async function reloadCache(): Promise<void> {
  await fetch(`${BASE}/reload`, { method: 'POST' })
}

async function resetLaunchBox(): Promise<{ ok: boolean; sent_to?: string; note?: string; error?: string }> {
  const r = await fetch(`${BASE}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relaunch: true })
  })
  return r.json()
}

const PAGE_SIZE = 60

function GameCard({ game, launching, onLaunch }: {
  game: LbGame
  launching: string | null
  onLaunch: (id: string) => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const isLaunching = launching === game.id

  return (
    <DraggableMedia
      id={`lb-${game.id}`}
      item={{ app: 'launchbox', ref_id: game.id, ref_type: game.platform, title: game.title, thumb: `${BASE}/image/${game.id}` }}
      className="relative group"
    >
      <button
        onClick={() => onLaunch(game.id)}
        disabled={!!launching}
        className="w-full flex flex-col bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-60"
      >
        {/* Pochette */}
        <div className="relative w-full aspect-[3/4] bg-zinc-800 shrink-0">
          {!imgErr ? (
            <img
              src={`${BASE}/image/${game.id}`}
              alt={game.title}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={() => setImgErr(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Gamepad2 size={32} className="text-zinc-600" />
            </div>
          )}

          {/* Overlay play */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            {isLaunching
              ? <Loader2 size={28} className="text-amber-400 animate-spin" />
              : <Play size={28} className="text-white fill-white" />
            }
          </div>
        </div>

        {/* Infos */}
        <div className="p-2 min-w-0">
          <p className="text-xs font-medium text-zinc-200 truncate leading-tight">{game.title}</p>
          {game.publisher && <p className="text-[10px] text-zinc-500 truncate mt-0.5">{game.publisher}</p>}
        </div>
      </button>
      <FavoriteButton
        fav={{ app: 'launchbox', ref_id: game.id, ref_type: game.platform, title: game.title, thumb: `${BASE}/image/${game.id}` }}
        className="reveal absolute top-2 right-2 w-7 h-7"
      />
      <AddToPlaylist
        item={{ app: 'launchbox', ref_id: game.id, ref_type: game.platform, title: game.title, thumb: `${BASE}/image/${game.id}` }}
        className="reveal absolute top-2 right-11 w-7 h-7"
      />
    </DraggableMedia>
  )
}

export default function Launchbox() {
  const [platforms, setPlatforms] = useState<string[]>([])
  const [selectedPlatform, setSelectedPlatform] = usePersistedState<string>('hub.lb.platform', '')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [items, setItems] = useState<LbGame[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sort, setSort] = usePersistedState('hub.lb.sort', '') // '' = ordre LaunchBox
  const [error, setError] = useState<string | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)
  const [launchMsg, setLaunchMsg] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [resetting, setResetting] = useState(false)
  // Cascade : développée à l'entrée du module (la sidebar système, elle, se réduit)
  const [platformsCollapsed, setPlatformsCollapsed] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const fetchedRef = useRef(0)

  // Charger les plateformes au montage
  useEffect(() => {
    fetchPlatforms()
      .then(p => {
        setPlatforms(p)
        // Garde la dernière plateforme active (persistée) si elle existe encore.
        if (p.length && !p.includes(selectedPlatform)) setSelectedPlatform(p[0])
      })
      .catch(e => setError(e.message))
  }, [])

  // Debounce recherche
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [q])

  // Charger (et réinitialiser) quand les filtres changent
  useEffect(() => {
    if (!platforms.length) return
    setLoading(true)
    setError(null)
    setItems([])
    setTotal(0)
    fetchedRef.current = 0
    fetchGames({ platform: selectedPlatform || undefined, q: debouncedQ || undefined, start: 0, limit: PAGE_SIZE, sort: sort || undefined })
      .then(r => {
        setTotal(r.total)
        setItems(r.items)
        fetchedRef.current = r.items.length
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [platforms.length, selectedPlatform, debouncedQ, sort])

  // Charger la page suivante
  const hasMore = items.length < total
  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return
    const offset = fetchedRef.current
    setLoadingMore(true)
    fetchGames({ platform: selectedPlatform || undefined, q: debouncedQ || undefined, start: offset, limit: PAGE_SIZE, sort: sort || undefined })
      .then(r => {
        setItems(prev => [...prev, ...r.items])
        fetchedRef.current = offset + r.items.length
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false))
  }, [loadingMore, loading, hasMore, selectedPlatform, debouncedQ, sort])

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

  const handleLaunch = async (gameId: string) => {
    setLaunching(gameId)
    setLaunchMsg(null)
    try {
      const r = await launchGame(gameId)
      setLaunchMsg(`Lancement : ${r.title}`)
      setTimeout(() => setLaunchMsg(null), 3000)
    } catch (e: any) {
      setLaunchMsg(`Erreur : ${e.message}`)
      setTimeout(() => setLaunchMsg(null), 4000)
    } finally {
      setLaunching(null)
    }
  }

  const handleReset = async () => {
    if (resetting) return
    if (!confirm('Tuer et relancer LaunchBox sur le PC ?\n\nUtile si MarquesasServer est coincé sur "A game is currently being played". Nécessite que hub-agent.exe tourne sur le PC LaunchBox.')) return
    setResetting(true)
    setLaunchMsg(null)
    try {
      const r = await resetLaunchBox()
      if (r.ok) {
        setLaunchMsg(`LaunchBox relancé sur ${r.sent_to}. Attendre ~5s avant de relancer un jeu.`)
        setTimeout(() => setLaunchMsg(null), 6000)
      } else {
        setLaunchMsg(`Erreur : ${r.error ?? 'inconnue'}`)
        setTimeout(() => setLaunchMsg(null), 6000)
      }
    } catch (e: any) {
      setLaunchMsg(`Erreur : ${e.message}`)
      setTimeout(() => setLaunchMsg(null), 6000)
    } finally {
      setResetting(false)
    }
  }

  const handleReload = async () => {
    setReloading(true)
    try {
      await reloadCache()
      setPlatforms([])
      setItems([])
      setTotal(0)
      fetchedRef.current = 0
      const p = await fetchPlatforms()
      setPlatforms(p)
    } catch { /* ignoré */ }
    finally { setReloading(false) }
  }

  return (
    <CatalogDndProvider>
    <div className="flex h-full">

      {/* ── Sidebar plateformes (collapsible) ─────────────────────── */}
      <aside
        className={`${platformsCollapsed ? 'w-14 cursor-pointer' : 'w-52'} shrink-0 bg-zinc-950/60 border-r border-zinc-800 flex flex-col transition-[width] duration-200 overflow-hidden`}
        // Vue élargie d'un simple clic n'importe où sur la sidebar réduite
        onClick={e => {
          if (platformsCollapsed && !(e.target as HTMLElement).closest('button')) setPlatformsCollapsed(false)
        }}
      >
        <div className="h-[53px] shrink-0 border-b border-zinc-800 flex items-center px-3">
          {platformsCollapsed
            ? <Gamepad2 size={16} strokeWidth={1.8} className="mx-auto text-zinc-500" />
            : <span className="text-sm font-semibold text-white truncate">LaunchBox</span>
          }
        </div>
        <nav className="flex-1 py-1 overflow-y-auto">
          <button
            onClick={() => setSelectedPlatform('')}
            title={platformsCollapsed ? 'Toutes les plateformes' : undefined}
            className={`w-full flex items-center py-3 text-sm transition-colors text-left border-l-2 ${
              platformsCollapsed ? 'justify-center px-0' : 'gap-2.5 px-4'
            } ${
              selectedPlatform === ''
                ? 'bg-zinc-800 text-white border-amber-500'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
            }`}
          >
            <Library size={15} strokeWidth={1.8} />
            {!platformsCollapsed && <span className="truncate">Toutes les plateformes</span>}
          </button>
          {platforms.map(p => (
            <button
              key={p}
              onClick={() => setSelectedPlatform(p)}
              title={platformsCollapsed ? p : undefined}
              className={`w-full flex items-center py-3 text-sm transition-colors text-left border-l-2 ${
                platformsCollapsed ? 'justify-center px-0' : 'gap-2.5 px-4'
              } ${
                selectedPlatform === p
                  ? 'bg-zinc-800 text-white border-amber-500'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
              }`}
            >
              <Gamepad2 size={15} strokeWidth={1.8} />
              {!platformsCollapsed && <span className="truncate">{p}</span>}
            </button>
          ))}
        </nav>
        <div className="h-[45px] shrink-0 border-t border-zinc-800 flex items-center px-3">
          <button
            onClick={() => setPlatformsCollapsed(v => !v)}
            title={platformsCollapsed ? 'Agrandir' : 'Réduire'}
            className={`text-zinc-600 hover:text-zinc-300 transition-colors ${platformsCollapsed ? 'mx-auto' : 'ml-auto'}`}
          >
            {platformsCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </aside>

      {/* ── Zone de contenu ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Barre de contrôles */}
        <div className="flex items-center gap-2 px-4 min-h-[53px] border-b border-zinc-800 shrink-0 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Rechercher un jeu…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded pl-8 pr-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
            />
          </div>

          {/* Tri (serveur : liste paginée) */}
          <select
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600 shrink-0"
            value={sort}
            onChange={e => setSort(e.target.value)}
            title="Tri"
          >
            <option value="">Tri : par défaut</option>
            <option value="title_asc">Titre A → Z</option>
            <option value="title_desc">Titre Z → A</option>
          </select>

          {total > 0 && (
            <span className="text-xs text-zinc-500 shrink-0">{total} jeu{total !== 1 ? 'x' : ''}</span>
          )}

          <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-amber-400 disabled:opacity-50 transition-colors"
              title="Tuer + relancer LaunchBox sur le PC (débloque MarquesasServer si coincé)"
            >
              <RotateCcw size={13} className={resetting ? 'animate-spin' : ''} />
              Reset LaunchBox
            </button>
            <button
              onClick={handleReload}
              disabled={reloading}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
              title="Recharger le cache"
            >
              <RefreshCw size={13} className={reloading ? 'animate-spin' : ''} />
              Recharger
            </button>
          </div>
        </div>

        {/* Contenu scrollable */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Message lancement */}
          {launchMsg && (
            <div className={`px-3 py-2 rounded text-xs ${launchMsg.startsWith('Erreur') ? 'bg-red-900/40 border border-red-800 text-red-300' : 'bg-green-900/40 border border-green-800 text-green-300'}`}>
              {launchMsg}
            </div>
          )}

          {/* Erreur */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded p-3">
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          {/* Chargement initial */}
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center py-16 text-zinc-500">
              <Loader2 size={22} className="animate-spin mr-2" />
              Chargement…
            </div>
          )}

          {/* Grille de jeux */}
          {items.length > 0 && (
            <div
              className={`grid gap-3 ${loading ? 'opacity-60' : ''}`}
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
            >
              {items.map(game => (
                <GameCard key={game.id} game={game} launching={launching} onLaunch={handleLaunch} />
              ))}
            </div>
          )}

          {!loading && !error && items.length === 0 && platforms.length > 0 && (
            <div className="text-center py-16 text-zinc-500 text-sm">Aucun jeu trouvé</div>
          )}

          {/* Sentinel scroll infini */}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-4 text-zinc-500">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
    </CatalogDndProvider>
  )
}
