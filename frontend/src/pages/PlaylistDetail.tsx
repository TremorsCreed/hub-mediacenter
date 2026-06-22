import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api, Device, Playlist, PlaylistItem, ProgressItem, TraktWatched } from '../api'
import { usePersistentDevice } from '../usePersistentDevice'
import { useUser } from '../UserContext'
import { useWatched } from '../WatchedContext'
import Toast from '../components/Toast'
import CurrentButton from '../components/CurrentButton'
import ResolveItemModal from '../components/ResolveItemModal'
import EditPlaylistModal from '../components/EditPlaylistModal'
import PlaylistJsonModal from '../components/PlaylistJsonModal'
import {
  ArrowLeft, Play, Loader2, Trash2, GripVertical, Film, Tv, Gamepad2, Radio, MonitorPlay,
  Users, Lock, AlertTriangle, Check, Eye, EyeOff, RotateCcw, Replace, Pencil, Share2, Menu, Braces,
  ChevronRight, ChevronDown,
} from 'lucide-react'

// Menu d'actions d'une ligne (burger) : ouvert en position fixe pour ne pas être
// rogné par l'overflow-hidden de la tuile (barre de progression). Ferme au clic extérieur.
function RowMenu({ busy, children }: { busy: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    setOpen(true)
  }
  return (
    <>
      <button ref={btnRef} onClick={toggle} title="Options" aria-label="Options"
        className="shrink-0 text-zinc-500 hover:text-zinc-200 p-1.5 transition-colors">
        {busy ? <Loader2 size={16} className="animate-spin text-amber-400" /> : <Menu size={16} />}
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />
          <div className="fixed z-[151] min-w-[190px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 overflow-hidden"
            style={{ top: pos.top, right: pos.right }}>
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Tv; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-zinc-800 ${danger ? 'text-red-300 hover:text-red-200' : 'text-zinc-200'}`}>
      <Icon size={15} className="shrink-0" /> {label}
    </button>
  )
}

// Normalisation de titre pour le matching « vu » Trakt (sans accents/ponctuation).
const tnorm = (s?: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const APP_ICON: Record<string, typeof Tv> = { iptv: Radio, plex: Film, launchbox: Gamepad2, catalog: MonitorPlay }

function itemImg(it: PlaylistItem): string {
  if (!it.thumb) return ''
  if (it.app === 'launchbox') return it.thumb
  if (it.app === 'plex') return api.plex.imageUrl(it.thumb)
  return api.iptv.imageUrl(it.thumb)
}

// Détecte un item épisode d'après le titre « Show · S01E02 · … » (format généré par
// l'import/JSON/Trakt). Sert à regrouper les épisodes par série + saison.
function parseEp(it: PlaylistItem): { show: string; season: number; episode: number } | null {
  const m = (it.title ?? '').match(/^(.+?)\s*·\s*S(\d{1,2})E(\d{1,3})\b/i)
  if (!m) return null
  return { show: m[1].trim(), season: Number(m[2]), episode: Number(m[3]) }
}

type RowActions = {
  canEdit: boolean
  onPlay: (it: PlaylistItem) => void; onRemove: (it: PlaylistItem) => void
  onToggleSeen: (it: PlaylistItem) => void; onResolve: (it: PlaylistItem) => void
  busy: boolean; seen: boolean; progressPct: number | null
}

// Contenu visuel d'une ligne (n° + visuel + titre + menu burger), partagé entre une
// ligne déplaçable (SortableRow) et une ligne d'épisode dans un groupe (EpisodeRow).
function RowBody({ it, label, indent, listeners, handle, canEdit, onPlay, onRemove, onToggleSeen, onResolve, busy, seen, progressPct }: RowActions & {
  it: PlaylistItem; label: ReactNode; indent?: boolean; listeners?: any; handle?: ReactNode
}) {
  const Icon = APP_ICON[it.app] ?? Tv
  const missing = it.status === 'missing' || it.app === 'unresolved'
  return (
    <>
      {progressPct != null && (
        <div className="absolute inset-y-0 left-0 bg-green-500/20 pointer-events-none" style={{ width: `${progressPct}%`, zIndex: -1 }} />
      )}
      <div
        {...(listeners ?? {})}
        className={`flex items-center gap-3 flex-1 min-w-0 py-2 ${indent ? 'pl-1' : 'pl-2'} select-none ${listeners ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
      >
        {handle}
        <span className="text-xs text-zinc-500 w-7 text-right shrink-0">{label}</span>
        <div className={`relative ${indent ? 'w-9 h-12' : 'w-10 h-14'} rounded bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center`}>
          {itemImg(it)
            ? <img src={itemImg(it)} alt="" loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
            : <Icon size={16} className="text-zinc-600" />}
          {seen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 ring-2 ring-zinc-900 flex items-center justify-center" title="Vu">
              <Check size={10} className="text-black" strokeWidth={3} />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-1.5">
            {it.title ?? 'Sans titre'}
            {missing && <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 rounded px-1.5 py-0.5"><AlertTriangle size={10} /> manquant</span>}
          </div>
          <div className="text-xs text-zinc-500 flex items-center gap-1.5">
            <Icon size={11} /> {it.app}{it.year ? ` · ${it.year}` : ''}{it.lang ? ` · ${it.lang}` : ''}
            {progressPct != null && <span className="text-green-400 font-medium">· En cours {progressPct}%</span>}
          </div>
        </div>
      </div>

      {(!missing || canEdit) && (
        <RowMenu busy={busy}>
          {close => (
            <>
              {!missing && <MenuItem icon={Play} label="Lancer" onClick={() => { close(); onPlay(it) }} />}
              {!missing && <MenuItem icon={seen ? EyeOff : Eye} label={seen ? 'Marquer non vu' : 'Marquer vu'} onClick={() => { close(); onToggleSeen(it) }} />}
              {canEdit && <MenuItem icon={Replace} label={missing ? 'Résoudre' : 'Changer la version'} onClick={() => { close(); onResolve(it) }} />}
              {canEdit && <MenuItem icon={Trash2} label="Retirer" danger onClick={() => { close(); onRemove(it) }} />}
            </>
          )}
        </RowMenu>
      )}
    </>
  )
}

// Ligne déplaçable (film, série entière, ou en-tête de bloc simple).
function SortableRow({ it, label, ...actions }: RowActions & { it: PlaylistItem; label: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: it.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className={`relative overflow-hidden flex items-center gap-3 bg-zinc-900 border rounded-lg pr-2 ${isDragging ? 'border-amber-500/60 shadow-lg' : 'border-zinc-800'} ${actions.seen && !isDragging ? 'opacity-60' : ''}`}>
      <RowBody it={it} label={label}
        listeners={actions.canEdit ? listeners : undefined}
        handle={actions.canEdit ? <GripVertical size={16} className="text-zinc-600 shrink-0" /> : undefined}
        {...actions} />
    </div>
  )
}

// Ligne d'épisode imbriquée dans un groupe de saison (non déplaçable individuellement).
function EpisodeRow({ it, label, ...actions }: RowActions & { it: PlaylistItem; label: ReactNode }) {
  return (
    <div className={`relative overflow-hidden flex items-center gap-3 bg-zinc-900/60 border border-zinc-800/70 rounded-lg pr-2 ${actions.seen ? 'opacity-60' : ''}`}>
      <RowBody it={it} label={label} indent {...actions} />
    </div>
  )
}

// En-tête repliable d'un groupe de saison (déplaçable en bloc).
function GroupHeader({ groupId, show, season, count, seenCount, missingCount, thumb, expanded, canEdit, onToggle, onPlaySeason, onMarkSeason, onRemoveSeason }: {
  groupId: string; show: string; season: number; count: number; seenCount: number; missingCount: number
  thumb: string; expanded: boolean; canEdit: boolean
  onToggle: () => void; onPlaySeason: () => void; onMarkSeason: (seen: boolean) => void; onRemoveSeason: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: groupId })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className={`relative flex items-center gap-2 bg-zinc-900 border rounded-lg pr-2 ${isDragging ? 'border-amber-500/60 shadow-lg' : 'border-zinc-800'}`}>
      {canEdit && (
        <div {...listeners} className="pl-2 py-3 cursor-grab touch-none active:cursor-grabbing">
          <GripVertical size={16} className="text-zinc-600 shrink-0" />
        </div>
      )}
      <button onClick={onToggle} className={`flex items-center gap-2.5 flex-1 min-w-0 py-2 text-left ${canEdit ? '' : 'pl-2'}`}>
        {expanded ? <ChevronDown size={16} className="text-zinc-400 shrink-0" /> : <ChevronRight size={16} className="text-zinc-400 shrink-0" />}
        <div className="relative w-9 h-12 rounded bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
          {thumb ? <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} /> : <Tv size={15} className="text-zinc-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{show} <span className="text-zinc-500 font-normal">— Saison {season}</span></div>
          <div className="text-xs text-zinc-500 flex items-center gap-1.5">
            {count} épisode{count > 1 ? 's' : ''} · {seenCount}/{count} vu{seenCount > 1 ? 's' : ''}
            {missingCount > 0 && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle size={10} /> {missingCount} manquant{missingCount > 1 ? 's' : ''}</span>}
          </div>
        </div>
      </button>
      <button onClick={onPlaySeason} title="Lancer la saison" className="shrink-0 text-zinc-500 hover:text-amber-400 p-1.5 transition-colors">
        <Play size={15} fill="currentColor" />
      </button>
      <RowMenu busy={false}>
        {close => (
          <>
            <MenuItem icon={Eye} label="Marquer la saison vue" onClick={() => { close(); onMarkSeason(true) }} />
            <MenuItem icon={EyeOff} label="Marquer la saison non vue" onClick={() => { close(); onMarkSeason(false) }} />
            {canEdit && <MenuItem icon={Trash2} label="Retirer la saison" danger onClick={() => { close(); onRemoveSeason() }} />}
          </>
        )}
      </RowMenu>
    </div>
  )
}

export default function PlaylistDetail() {
  const { id } = useParams()
  const plId = Number(id)
  const navigate = useNavigate()
  const { currentUser, adminUnlocked } = useUser()
  const { isWatched, toggle: toggleWatched } = useWatched()
  const [pl, setPl] = useState<Playlist | null>(null)
  const [items, setItems] = useState<PlaylistItem[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const { deviceId, setDeviceId, reconcile } = usePersistentDevice()
  const [busy, setBusy] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [progress, setProgress] = useState<ProgressItem[]>([])
  const [resolveTarget, setResolveTarget] = useState<PlaylistItem | null>(null)
  const [traktWatched, setTraktWatched] = useState<TraktWatched | null>(null)
  const [editing, setEditing] = useState(false)
  const [editingJson, setEditingJson] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [traktLinked, setTraktLinked] = useState(false)
  const [pushing, setPushing] = useState(false)

  const canEdit = !!pl && (adminUnlocked || pl.owner_user_id === currentUser?.id)

  // Appui long ~1s avant de déclencher le drag (confort tablette/TV + ne bloque pas le scroll).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 1000, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 1000, tolerance: 8 } }),
  )

  const load = () => api.playlists.get(plId).then(p => { setPl(p); setItems(p.items ?? []) }).catch(() => navigate('/playlists'))
  useEffect(() => { load() }, [plId])

  // « En cours » : positions de reprise (mode all = inclut les lectures à peine entamées),
  // pour reprendre à la bonne seconde même après un arrêt précoce.
  const loadProgress = () => api.state.progress(true).then(setProgress).catch(() => {})
  useEffect(() => { loadProgress() }, [])

  // « Vu » Trakt : historique de visionnage du profil (alimenté par le scrobbling).
  useEffect(() => { api.trakt.watched().then(setTraktWatched).catch(() => {}) }, [])
  // Compte Trakt lié au profil actif ? (conditionne le bouton « Pousser vers Trakt »)
  useEffect(() => {
    api.trakt.auth.status().then(s => setTraktLinked(s.accounts.some(a => a.user_id === currentUser?.id))).catch(() => {})
  }, [currentUser?.id])
  const traktSets = useMemo(() => {
    const movies = new Set((traktWatched?.movies ?? []).map(m => tnorm(m.title)))
    const shows = new Map<string, Set<string>>()
    for (const s of traktWatched?.shows ?? []) shows.set(tnorm(s.title), new Set(s.episodes))
    return { movies, shows }
  }, [traktWatched])

  // Item vu d'après Trakt (film par titre, série par titre, épisode par "Show · SxxExx").
  const isSeenTrakt = (it: PlaylistItem): boolean => {
    if (!traktWatched) return false
    if (it.ref_type === 'episode') {
      const se = (it.title ?? '').match(/s(\d{1,2})e(\d{1,3})/i)
      if (!se) return false
      const eps = traktSets.shows.get(tnorm((it.title ?? '').split('·')[0]))
      return !!eps && eps.has(`${Number(se[1])}-${Number(se[2])}`)
    }
    if (it.ref_type === 'series' || it.ref_type === 'show') return traktSets.shows.has(tnorm(it.title))
    return traktSets.movies.has(tnorm(it.title))
  }

  // Position de reprise d'un item, si entamé (cross-ref playback_progress).
  const progressFor = (it: PlaylistItem): ProgressItem | undefined => {
    if (!it.ref_id) return undefined
    if (it.app === 'plex') return progress.find(p => p.plex_id === it.ref_id)
    if (it.app === 'iptv') return progress.find(p => p.iptv_stream_id === it.ref_id)
    return undefined
  }

  useEffect(() => {
    api.devices.list().then(ds => {
      setDevices(ds)
      reconcile(ds)
    })
  }, [])

  const flash = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  // Regroupe les épisodes consécutifs d'une même série + saison sous un bloc repliable.
  // Les autres items (films, séries entières, épisodes isolés) restent des blocs simples.
  type Block =
    | { kind: 'single'; id: number; item: PlaylistItem }
    | { kind: 'group'; id: string; show: string; season: number; items: PlaylistItem[] }
  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = []
    for (const it of items) {
      const ep = parseEp(it)
      if (ep) {
        const gid = `grp:${tnorm(ep.show)}:${ep.season}`
        const last = out[out.length - 1]
        if (last && last.kind === 'group' && last.id === gid) last.items.push(it)
        else out.push({ kind: 'group', id: gid, show: ep.show, season: ep.season, items: [it] })
      } else {
        out.push({ kind: 'single', id: it.id, item: it })
      }
    }
    // Un groupe à 1 seul épisode ne mérite pas un repli : on le rétrograde en bloc simple.
    return out.map(b => (b.kind === 'group' && b.items.length === 1 ? { kind: 'single', id: b.items[0].id, item: b.items[0] } as Block : b))
  }, [items])

  // Réordonne au niveau bloc : déplacer un groupe replié bouge toute la saison ;
  // l'ordre interne d'une saison suit la playlist (réordonnage fin via l'éditeur JSON).
  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = blocks.findIndex(b => String(b.id) === String(active.id))
    const newIndex = blocks.findIndex(b => String(b.id) === String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(blocks, oldIndex, newIndex)
    const byId = new Map(items.map(i => [i.id, i]))
    const flatIds = reordered.flatMap(b => (b.kind === 'single' ? [b.item.id] : b.items.map(i => i.id)))
    setItems(flatIds.map(id => byId.get(id)!)) // optimiste
    await api.playlists.reorder(plId, flatIds).catch(load)
  }

  const removeItem = async (it: PlaylistItem) => {
    setItems(prev => prev.filter(i => i.id !== it.id))
    await api.playlists.removeItem(plId, it.id).catch(load)
  }

  const toggleGroup = (gid: string) => setExpandedGroups(prev => {
    const next = new Set(prev)
    next.has(gid) ? next.delete(gid) : next.add(gid)
    return next
  })

  // Lance une saison : reprend à l'item entamé, sinon au 1er non-vu, sinon au début.
  const playSeason = (groupItems: PlaylistItem[]) => {
    const playable = groupItems.filter(it => !isMissing(it))
    if (!playable.length) { flash('Aucun épisode jouable', false); return }
    play(playable.find(it => progressFor(it)) ?? playable.find(it => !isSeen(it)) ?? playable[0])
  }

  const markSeason = (groupItems: PlaylistItem[], seen: boolean) => {
    groupItems.filter(it => !isMissing(it)).forEach(it => { if (isSeen(it) !== seen) onToggleSeen(it) })
  }

  const removeSeason = async (groupItems: PlaylistItem[]) => {
    if (!confirm(`Retirer les ${groupItems.length} épisodes de cette saison ?`)) return
    const ids = new Set(groupItems.map(i => i.id))
    setItems(prev => prev.filter(i => !ids.has(i.id)))
    await Promise.all(groupItems.map(g => api.playlists.removeItem(plId, g.id))).catch(load)
  }

  const play = async (it: PlaylistItem) => {
    // Série IPTV entière → module ; un épisode IPTV (ext = container_extension) se lit directement.
    if (it.app === 'iptv' && it.ref_type === 'series' && !it.ext) { navigate('/catalog/iptv'); return }
    if (it.app === 'plex' && it.ref_type === 'show') { navigate('/catalog/plex'); return }
    if (it.app !== 'launchbox' && !deviceId) { flash('Choisis un device', false); return }
    if (!it.ref_id) return
    const prog = progressFor(it)
    setBusy(it.id)
    try {
      if (it.app === 'launchbox') {
        const r = await fetch('/api/launchbox/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(currentUser ? { 'X-User-Id': String(currentUser.id) } : {}) },
          body: JSON.stringify({ game_id: it.ref_id }),
        })
        if (!r.ok) throw new Error('échec')
        flash(`▶ ${it.title}`, true)
      } else if (it.app === 'iptv') {
        const r = await api.play({ iptv_stream_id: it.ref_id, iptv_type: (it.ref_type as any) ?? 'vod', iptv_ext: it.ext ?? undefined, title: it.title, thumb: it.thumb, resume_position_ms: prog?.position, app: 'iptv', device_id: deviceId, requester: 'manual' })
        flash(prog ? `⟲ ${r.title}` : `▶ ${r.title}`, true)
      } else if (it.app === 'plex') {
        const r = await api.play({ plex_id: it.ref_id, title: it.title, thumb: it.thumb, resume: true, resume_position_ms: prog?.position, app: 'plex', device_id: deviceId, requester: 'manual' })
        flash(prog ? `⟲ ${r.title}` : `▶ ${r.title}`, true)
      }
      // recharge la progression peu après (la position « En cours » se met à jour côté agent)
      setTimeout(loadProgress, 4000)
    } catch (e: any) {
      flash(`Échec : ${e.message}`, false)
    } finally {
      setBusy(null)
    }
  }

  // « Vu » pour la playlist : marquage explicite par le profil (toggle œil) OU historique
  // Trakt (scrobbling). On ne se base PLUS sur « lancé » (un film à peine ouvert ≠ vu).
  const isSeen = (it: PlaylistItem): boolean =>
    (!!it.ref_id && isWatched(it.app, it.ref_id)) || isSeenTrakt(it)
  const isMissing = (it: PlaylistItem) => it.status === 'missing' || it.app === 'unresolved'

  const onToggleSeen = (it: PlaylistItem) => {
    if (!it.ref_id) return
    toggleWatched({ app: it.app, ref_id: it.ref_id, ref_type: it.ref_type, title: it.title, thumb: it.thumb })
  }

  // Item entamé le plus récent (En cours) — il prime sur le « 1er non-vu ».
  const inProgressItem = (): PlaylistItem | null => {
    const withProg = items
      .filter(it => !isMissing(it))
      .map(it => ({ it, p: progressFor(it) }))
      .filter(x => x.p) as { it: PlaylistItem; p: ProgressItem }[]
    if (!withProg.length) return null
    withProg.sort((a, b) => b.p.updated_at - a.p.updated_at)
    return withProg[0].it
  }

  // Reprend la playlist : item entamé en priorité, sinon 1er non-vu, sinon début.
  const resume = () => {
    const playable = items.filter(it => !isMissing(it))
    if (!playable.length) { flash('Aucun élément jouable', false); return }
    const next = inProgressItem() ?? playable.find(it => !isSeen(it)) ?? playable[0]
    play(next)
  }

  const toggleShared = async () => {
    if (!pl || !canEdit) return
    await api.playlists.update(pl.id, { is_shared: !pl.is_shared }).catch(() => {})
    load()
  }

  const deletePlaylist = async () => {
    if (!pl || !confirm(`Supprimer la playlist « ${pl.name} » ?`)) return
    await api.playlists.remove(pl.id).catch(() => {})
    navigate('/playlists')
  }

  // Pousse la playlist vers Trakt : crée une nouvelle liste sur le compte du profil
  // et y verse les items (résolus par titre côté backend). Ouvre la liste créée.
  const pushToTrakt = async () => {
    if (!pl || pushing) return
    const count = items.filter(it => !isMissing(it)).length
    if (!confirm(`Créer une liste Trakt « ${pl.name} » et y verser ${count} élément${count > 1 ? 's' : ''} ?\n(une nouvelle liste est créée à chaque envoi)`)) return
    setPushing(true)
    try {
      const r = await api.trakt.pushList(pl.id)
      const miss = r.missing?.length ? ` · ${r.missing.length} introuvable${r.missing.length > 1 ? 's' : ''}` : ''
      flash(`Poussé vers Trakt : ${r.resolved} ajouté${r.resolved > 1 ? 's' : ''}${miss}`, true)
      window.open(r.url, '_blank')
    } catch (e: any) {
      flash(`Trakt : ${e.message}`, false)
    } finally { setPushing(false) }
  }

  if (!pl) return <div className="flex justify-center py-16 text-zinc-600"><Loader2 size={20} className="animate-spin" /></div>

  const playableItems = items.filter(it => !isMissing(it))
  const seenCount = playableItems.filter(isSeen).length
  const allSeen = playableItems.length > 0 && seenCount === playableItems.length
  const ongoing = inProgressItem()
  const ongoingPct = ongoing ? progressFor(ongoing)?.percent ?? null : null
  const nextUnseen = playableItems.find(it => !isSeen(it)) ?? null

  return (
    <div className="space-y-5 max-w-3xl">
      <button onClick={() => navigate('/playlists')} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
        <ArrowLeft size={13} /> Playlists
      </button>

      {/* En-tête */}
      <div className="flex gap-4 items-start">
        <div className="w-40 aspect-[16/9] rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
          {pl.cover ? <img src={pl.cover} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} /> : <MonitorPlay size={28} className="text-zinc-700" />}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{pl.name}</h1>
          {pl.description && <p className="text-sm text-zinc-400 mt-1 line-clamp-3">{pl.description}</p>}
          <div className="text-xs text-zinc-500 mt-2">{items.length} élément{items.length > 1 ? 's' : ''}{pl.owner_name && pl.owner_user_id !== currentUser?.id ? ` · ${pl.owner_name}` : ''}</div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button onClick={toggleShared} disabled={!canEdit}
              className={`flex items-center gap-1.5 text-xs rounded px-2.5 py-1 border transition-colors ${pl.is_shared ? 'border-cyan-700/60 text-cyan-300' : 'border-zinc-700 text-zinc-400'} ${canEdit ? 'hover:border-zinc-500' : 'opacity-70'}`}>
              {pl.is_shared ? <><Users size={12} /> Partagée</> : <><Lock size={12} /> Perso</>}
            </button>
            <CurrentButton
              item={{ key: `playlist:${pl.id}`, kind: 'playlist', playlist_id: pl.id, title: pl.name, thumb: pl.cover }}
              label="En cours"
              className="border border-zinc-700 px-2.5 py-1 hover:border-amber-500/50 text-xs"
              size={13}
            />
            {canEdit && (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs rounded px-2.5 py-1 border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors">
                <Pencil size={12} /> Modifier
              </button>
            )}
            {canEdit && (
              <button onClick={() => setEditingJson(true)} title="Éditer la liste en JSON (réordonner, ajouter, retirer en masse)"
                className="flex items-center gap-1.5 text-xs rounded px-2.5 py-1 border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors">
                <Braces size={12} /> JSON
              </button>
            )}
            {canEdit && traktLinked && (
              <button onClick={pushToTrakt} disabled={pushing} title="Créer une liste Trakt à partir de cette playlist"
                className="flex items-center gap-1.5 text-xs rounded px-2.5 py-1 border border-red-700/60 text-red-300 hover:border-red-500 hover:text-red-200 transition-colors disabled:opacity-50">
                {pushing ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />} Pousser vers Trakt
              </button>
            )}
            {canEdit && (
              <button onClick={deletePlaylist} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-400 transition-colors px-2.5 py-1">
                <Trash2 size={12} /> Supprimer
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Barre device */}
      <div className="flex items-center gap-2">
        <select value={deviceId} onChange={e => setDeviceId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600">
          <option value="">— device —</option>
          {devices.map(d => <option key={d.id} value={d.id} disabled={!d.ws_connected}>{d.name} {d.ws_connected ? '' : '(offline)'}</option>)}
        </select>
        {canEdit && <span className="text-[11px] text-zinc-600">Appui long (~1s) pour déplacer une ligne ou une saison entière. Clique une saison pour la déplier.</span>}
      </div>

      {/* Reprendre la playlist : item entamé en priorité, sinon 1er non-vu */}
      {playableItems.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={resume}
            className="flex items-center gap-2 bg-amber-500 text-black font-medium rounded-lg px-5 py-2.5 hover:bg-amber-400 transition-colors">
            {ongoing ? <RotateCcw size={18} /> : allSeen ? <RotateCcw size={18} /> : <Play size={18} fill="currentColor" />}
            {ongoing ? 'Reprendre' : allSeen ? 'Revoir depuis le début' : seenCount > 0 ? 'Reprendre' : 'Lancer la playlist'}
          </button>
          <span className="text-xs text-zinc-500">
            {seenCount}/{playableItems.length} vu{seenCount > 1 ? 's' : ''}
            {ongoing ? (
              <> · reprise : <span className="text-amber-400">{ongoing.title}</span>{ongoingPct != null ? ` (${ongoingPct}%)` : ''}</>
            ) : nextUnseen ? (
              <> · prochain : <span className="text-zinc-300">{nextUnseen.title}</span></>
            ) : null}
          </span>
        </div>
      )}

      {/* Liste */}
      {items.length === 0 ? (
        <div className="text-sm text-zinc-600 bg-zinc-900/50 border border-zinc-800 rounded-lg py-10 text-center">
          Playlist vide. Ajoute du contenu depuis le catalogue avec le bouton « + playlist ».
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {blocks.map(b => b.kind === 'single' ? (
                <SortableRow key={b.id} it={b.item} label={items.indexOf(b.item) + 1} canEdit={canEdit}
                  onPlay={play} onRemove={removeItem} onToggleSeen={onToggleSeen} onResolve={setResolveTarget}
                  busy={busy === b.item.id} seen={isSeen(b.item)} progressPct={progressFor(b.item)?.percent ?? null} />
              ) : (
                <div key={b.id} className="space-y-1.5">
                  <GroupHeader
                    groupId={b.id} show={b.show} season={b.season} count={b.items.length}
                    seenCount={b.items.filter(isSeen).length}
                    missingCount={b.items.filter(isMissing).length}
                    thumb={itemImg(b.items.find(itemImg) ?? b.items[0])}
                    expanded={expandedGroups.has(b.id)} canEdit={canEdit}
                    onToggle={() => toggleGroup(b.id)}
                    onPlaySeason={() => playSeason(b.items)}
                    onMarkSeason={s => markSeason(b.items, s)}
                    onRemoveSeason={() => removeSeason(b.items)}
                  />
                  {expandedGroups.has(b.id) && (
                    <div className="space-y-1.5 ml-3 pl-3 border-l border-zinc-800">
                      {b.items.map(it => (
                        <EpisodeRow key={it.id} it={it} label={`E${parseEp(it)?.episode ?? ''}`} canEdit={canEdit}
                          onPlay={play} onRemove={removeItem} onToggleSeen={onToggleSeen} onResolve={setResolveTarget}
                          busy={busy === it.id} seen={isSeen(it)} progressPct={progressFor(it)?.percent ?? null} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {editing && pl && (
        <EditPlaylistModal
          playlist={pl}
          onClose={() => setEditing(false)}
          onDone={() => { load(); flash('Playlist mise à jour', true) }}
        />
      )}

      {editingJson && (
        <PlaylistJsonModal
          playlistId={plId}
          items={items}
          defaultLang={currentUser?.preferred_lang || 'FR'}
          onClose={() => setEditingJson(false)}
          onDone={() => { load(); loadProgress(); flash('Playlist mise à jour', true) }}
        />
      )}

      {resolveTarget && (
        <ResolveItemModal
          playlistId={plId}
          item={resolveTarget}
          defaultLang={resolveTarget.lang || currentUser?.preferred_lang || 'FR'}
          onClose={() => setResolveTarget(null)}
          onDone={() => { load(); flash('Version mise à jour', true) }}
        />
      )}

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  )
}
