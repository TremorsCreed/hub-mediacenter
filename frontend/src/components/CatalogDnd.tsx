import { createContext, useContext, useRef, useState, ReactNode, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  DragStartEvent, DragEndEvent,
} from '@dnd-kit/core'
import { api, Playlist, PlaylistItemInput } from '../api'
import { useUser } from '../UserContext'
import { ListVideo, Plus, Check } from 'lucide-react'

const HOLD_MS = 1000   // durée d'appui pour armer le drag (aligné avec le sensor)
const SHOW_AFTER = 140 // délai avant d'afficher l'anneau (évite le flash sur un tap)
const MOVE_TOLERANCE = 10

// ── Contexte interne : pilote l'anneau de chargement « hold-to-drag » ─────────
interface CtxValue {
  dragging: boolean
  armBegin: (x: number, y: number) => void
  armMove: (x: number, y: number) => void
  armEnd: () => void
}
const Ctx = createContext<CtxValue>({ dragging: false, armBegin: () => {}, armMove: () => {}, armEnd: () => {} })
export const useCatalogDnd = () => useContext(Ctx)

function compose(...fns: Array<Function | undefined>) {
  return (e: any) => fns.forEach(f => { if (f) (f as (ev: any) => void)(e) })
}

// ── Wrapper glissable (appui long ~1s, avec anneau de chargement au curseur) ──
// `item` pour un élément unique, ou `items` pour un lot (ex. une saison entière).
export function DraggableMedia({ id, item, items, label, children, className = '' }: {
  id: string; item?: PlaylistItemInput; items?: PlaylistItemInput[]; label?: string; children: ReactNode; className?: string
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { item, items, label } })
  const { armBegin, armMove, armEnd } = useCatalogDnd()

  const handlers = {
    onPointerDown: compose(listeners?.onPointerDown, (e: PointerEvent) => armBegin(e.clientX, e.clientY)),
    onPointerMove: compose(listeners?.onPointerMove, (e: PointerEvent) => armMove(e.clientX, e.clientY)),
    onPointerUp: compose(listeners?.onPointerUp, () => armEnd()),
    onPointerCancel: compose((listeners as any)?.onPointerCancel, () => armEnd()),
    onLostPointerCapture: compose((listeners as any)?.onLostPointerCapture, () => armEnd()),
  }

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} {...handlers}
      className={`${className} ${isDragging ? 'opacity-40' : ''}`}>
      {children}
    </div>
  )
}

// ── Une playlist comme cible de drop ─────────────────────────────────────────
function DropTarget({ pl }: { pl: Playlist }) {
  const { setNodeRef, isOver } = useDroppable({ id: `pl-${pl.id}`, data: { playlist: pl } })
  return (
    <div ref={setNodeRef}
      className={`flex items-center gap-2 px-3 py-3 rounded-lg border transition-colors ${
        isOver ? 'border-amber-500 bg-amber-500/15 scale-[1.02]' : 'border-zinc-700 bg-zinc-900'
      }`}>
      <ListVideo size={15} className={isOver ? 'text-amber-400' : 'text-zinc-500'} />
      <span className="flex-1 min-w-0 text-sm truncate">{pl.name}</span>
      <span className="text-[10px] text-zinc-600">{pl.item_count ?? 0}</span>
    </div>
  )
}

// ── Anneau de chargement qui se remplit au curseur pendant l'appui ───────────
function HoldRing({ x, y }: { x: number; y: number }) {
  const C = 2 * Math.PI * 16 // circonférence (r=16)
  return createPortal(
    <div className="fixed z-[150] pointer-events-none" style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}>
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="18" fill="rgba(9,9,11,0.7)" />
        <circle cx="22" cy="22" r="16" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
        <circle
          cx="22" cy="22" r="16" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={C} transform="rotate(-90 22 22)"
          style={{ animation: `holdFill ${HOLD_MS - SHOW_AFTER}ms linear forwards` }}
        />
      </svg>
      <Plus size={16} className="text-amber-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
    </div>,
    document.body,
  )
}

// ── Provider : à mettre autour du contenu d'un module catalogue ──────────────
export function CatalogDndProvider({ children }: { children: ReactNode }) {
  const { currentUser, adminUnlocked } = useUser()
  const [dragging, setDragging] = useState(false)
  const [previewLabel, setPreviewLabel] = useState<string | null>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null)
  const armStart = useRef<{ x: number; y: number } | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: HOLD_MS, tolerance: MOVE_TOLERANCE } }))

  const armEnd = useCallback(() => {
    armStart.current = null
    clearTimeout(showTimer.current)
    setRing(null)
  }, [])
  const armBegin = useCallback((x: number, y: number) => {
    armStart.current = { x, y }
    clearTimeout(showTimer.current)
    showTimer.current = setTimeout(() => setRing({ x, y }), SHOW_AFTER)
  }, [])
  const armMove = useCallback((x: number, y: number) => {
    const s = armStart.current
    if (!s) return
    if (Math.hypot(x - s.x, y - s.y) > MOVE_TOLERANCE) { armEnd(); return }
    setRing(r => (r ? { x, y } : r))
  }, [armEnd])

  const dragItems = (data: any): PlaylistItemInput[] =>
    (data?.items as PlaylistItemInput[]) ?? (data?.item ? [data.item as PlaylistItemInput] : [])

  const onStart = useCallback((e: DragStartEvent) => {
    armEnd() // l'anneau est plein → on bascule sur l'aperçu de drag
    setDragging(true)
    const data = e.active.data.current as any
    const list = dragItems(data)
    setPreviewLabel(data?.label ?? (list.length > 1 ? `${list.length} éléments` : list[0]?.title ?? 'Élément'))
    api.playlists.list()
      .then(ls => setPlaylists(ls.filter(p => adminUnlocked || p.owner_user_id === currentUser?.id)))
      .catch(() => setPlaylists([]))
  }, [adminUnlocked, currentUser, armEnd])

  const onEnd = useCallback(async (e: DragEndEvent) => {
    setDragging(false)
    const list = dragItems(e.active.data.current)
    const overId = e.over?.id ? String(e.over.id) : ''
    setPreviewLabel(null)
    if (list.length && overId.startsWith('pl-')) {
      const plId = Number(overId.slice(3))
      const pl = playlists.find(p => p.id === plId)
      let added = 0
      for (const it of list) {
        try { await api.playlists.addItem(plId, it); added++ } catch { /* */ }
      }
      setPlaylists(prev => prev.map(p => p.id === plId ? { ...p, item_count: (p.item_count ?? 0) + added } : p))
      setToast(added > 1 ? `${added} ajoutés à « ${pl?.name ?? 'la playlist'} »` : `Ajouté à « ${pl?.name ?? 'la playlist'} »`)
      setTimeout(() => setToast(null), 2500)
    }
  }, [playlists])

  return (
    <Ctx.Provider value={{ dragging, armBegin, armMove, armEnd }}>
      <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => { setDragging(false); setPreviewLabel(null); armEnd() }}>
        {children}

        {ring && !dragging && <HoldRing x={ring.x} y={ring.y} />}

        {dragging && createPortal(
          <div className="fixed top-0 right-0 bottom-0 z-[130] w-64 bg-zinc-950/95 backdrop-blur border-l border-zinc-700 p-4 flex flex-col gap-2 shadow-2xl animate-[slideIn_.15s_ease]">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Déposer dans une playlist</div>
            {playlists.length === 0 && <div className="text-xs text-zinc-600">Aucune playlist modifiable. Crée-en une d'abord.</div>}
            <div className="flex-1 overflow-y-auto space-y-2">
              {playlists.map(pl => <DropTarget key={pl.id} pl={pl} />)}
            </div>
          </div>,
          document.body
        )}

        <DragOverlay dropAnimation={null}>
          {previewLabel ? (
            <div className="flex items-center gap-2 bg-zinc-900 border border-amber-500/60 rounded-lg px-3 py-2 shadow-xl max-w-[220px]">
              <Plus size={14} className="text-amber-400 shrink-0" />
              <span className="text-sm truncate">{previewLabel}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {toast && createPortal(
        <div className="fixed bottom-6 right-6 z-[140] flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded shadow-lg text-sm font-medium">
          <Check size={15} /> {toast}
        </div>,
        document.body
      )}
    </Ctx.Provider>
  )
}
