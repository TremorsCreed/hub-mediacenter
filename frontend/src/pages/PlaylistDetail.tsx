import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api, Device, Playlist, PlaylistItem } from '../api'
import { usePersistentDevice } from '../usePersistentDevice'
import { useUser } from '../UserContext'
import Toast from '../components/Toast'
import {
  ArrowLeft, Play, Loader2, Trash2, GripVertical, Film, Tv, Gamepad2, Radio, MonitorPlay,
  Users, Lock, AlertTriangle, Check,
} from 'lucide-react'

// Reconstruit l'identifiant d'historique (entry.id) d'un item pour le marquage « vu ».
const playedKey = (it: PlaylistItem): string | null => {
  if (it.app === 'plex' && it.ref_id) return `plex:${it.ref_id}`
  if (it.app === 'iptv' && it.ref_id) return `iptv:${it.ref_type ?? 'vod'}:${it.ref_id}`
  return null
}

const APP_ICON: Record<string, typeof Tv> = { iptv: Radio, plex: Film, launchbox: Gamepad2, catalog: MonitorPlay }

function itemImg(it: PlaylistItem): string {
  if (!it.thumb) return ''
  if (it.app === 'launchbox') return it.thumb
  if (it.app === 'plex') return api.plex.imageUrl(it.thumb)
  return api.iptv.imageUrl(it.thumb)
}

function SortableRow({ it, index, canEdit, onPlay, onRemove, busy, watched }: {
  it: PlaylistItem; index: number; canEdit: boolean
  onPlay: (it: PlaylistItem) => void; onRemove: (it: PlaylistItem) => void; busy: boolean; watched: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: it.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const Icon = APP_ICON[it.app] ?? Tv
  const missing = it.status === 'missing' || it.app === 'unresolved'

  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className={`flex items-center gap-3 bg-zinc-900 border rounded-lg pr-2 ${isDragging ? 'border-amber-500/60 shadow-lg' : 'border-zinc-800'}`}>
      {/* Zone draggable (appui long ~1s) : poignée + n° + visuel + titre */}
      <div
        {...(canEdit ? listeners : {})}
        className={`flex items-center gap-3 flex-1 min-w-0 py-2 pl-2 select-none ${canEdit ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
      >
        {canEdit && <GripVertical size={16} className="text-zinc-600 shrink-0" />}
        <span className="text-xs text-zinc-500 w-5 text-right shrink-0">{index + 1}</span>
        <div className="relative w-10 h-14 rounded bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
          {itemImg(it)
            ? <img src={itemImg(it)} alt="" loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
            : <Icon size={16} className="text-zinc-600" />}
          {watched && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 ring-2 ring-zinc-900 flex items-center justify-center" title="Déjà lancé">
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
          </div>
        </div>
      </div>

      {!missing && (
        <button onClick={() => onPlay(it)} disabled={busy} title="Lancer"
          className="shrink-0 text-zinc-500 hover:text-amber-400 p-1.5 disabled:opacity-50 transition-colors">
          {busy ? <Loader2 size={15} className="animate-spin text-amber-400" /> : <Play size={15} fill="currentColor" />}
        </button>
      )}
      {canEdit && (
        <button onClick={() => onRemove(it)} title="Retirer" className="shrink-0 text-zinc-600 hover:text-red-400 p-1.5 transition-colors">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  )
}

export default function PlaylistDetail() {
  const { id } = useParams()
  const plId = Number(id)
  const navigate = useNavigate()
  const { currentUser, adminUnlocked } = useUser()
  const [pl, setPl] = useState<Playlist | null>(null)
  const [items, setItems] = useState<PlaylistItem[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const { deviceId, setDeviceId, reconcile } = usePersistentDevice()
  const [busy, setBusy] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [played, setPlayed] = useState<Set<string>>(new Set())

  const canEdit = !!pl && (adminUnlocked || pl.owner_user_id === currentUser?.id)

  // Appui long ~1s avant de déclencher le drag (confort tablette/TV + ne bloque pas le scroll).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 1000, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 1000, tolerance: 8 } }),
  )

  const load = () => api.playlists.get(plId).then(p => { setPl(p); setItems(p.items ?? []) }).catch(() => navigate('/playlists'))
  useEffect(() => { load() }, [plId])

  // Marquage « vu » : identifiants déjà lancés par le profil courant
  const loadPlayed = () => api.state.played().then(arr => setPlayed(new Set(arr))).catch(() => {})
  useEffect(() => { loadPlayed() }, [])

  useEffect(() => {
    api.devices.list().then(ds => {
      setDevices(ds)
      reconcile(ds)
    })
  }, [])

  const flash = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => i.id === active.id)
    const newIndex = items.findIndex(i => i.id === over.id)
    const reordered = arrayMove(items, oldIndex, newIndex)
    setItems(reordered) // optimiste
    await api.playlists.reorder(plId, reordered.map(i => i.id)).catch(load)
  }

  const removeItem = async (it: PlaylistItem) => {
    setItems(prev => prev.filter(i => i.id !== it.id))
    await api.playlists.removeItem(plId, it.id).catch(load)
  }

  const play = async (it: PlaylistItem) => {
    if (it.app === 'iptv' && it.ref_type === 'series') { navigate('/catalog/iptv'); return }
    if (it.app === 'plex' && it.ref_type === 'show') { navigate('/catalog/plex'); return }
    if (it.app !== 'launchbox' && !deviceId) { flash('Choisis un device', false); return }
    if (!it.ref_id) return
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
        const r = await api.play({ iptv_stream_id: it.ref_id, iptv_type: (it.ref_type as any) ?? 'vod', iptv_ext: it.ext ?? undefined, title: it.title, thumb: it.thumb, app: 'iptv', device_id: deviceId, requester: 'manual' })
        flash(`▶ ${r.title}`, true)
      } else if (it.app === 'plex') {
        const r = await api.play({ plex_id: it.ref_id, title: it.title, thumb: it.thumb, resume: true, app: 'plex', device_id: deviceId, requester: 'manual' })
        flash(`▶ ${r.title}`, true)
      }
      // rafraîchit le marquage « vu » après un lancement
      const k = playedKey(it)
      if (k) setPlayed(prev => new Set(prev).add(k))
    } catch (e: any) {
      flash(`Échec : ${e.message}`, false)
    } finally {
      setBusy(null)
    }
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

  if (!pl) return <div className="flex justify-center py-16 text-zinc-600"><Loader2 size={20} className="animate-spin" /></div>

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
        {canEdit && <span className="text-[11px] text-zinc-600">Appui long (~1s) sur une ligne pour la déplacer.</span>}
      </div>

      {/* Liste */}
      {items.length === 0 ? (
        <div className="text-sm text-zinc-600 bg-zinc-900/50 border border-zinc-800 rounded-lg py-10 text-center">
          Playlist vide. Ajoute du contenu depuis le catalogue avec le bouton « + playlist ».
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map((it, idx) => {
                const k = playedKey(it)
                return (
                  <SortableRow key={it.id} it={it} index={idx} canEdit={canEdit} onPlay={play} onRemove={removeItem} busy={busy === it.id} watched={!!k && played.has(k)} />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  )
}
