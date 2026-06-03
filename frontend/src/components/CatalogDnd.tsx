import { createContext, useContext, useState, ReactNode, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  DragStartEvent, DragEndEvent,
} from '@dnd-kit/core'
import { api, Playlist, PlaylistItemInput } from '../api'
import { useUser } from '../UserContext'
import { ListVideo, Plus, Check } from 'lucide-react'

// ── Wrapper rendant un contenu glissable vers le dock playlists ───────────────
// Appui long ~1s pour démarrer le drag (le tap continue de déclencher la lecture).
export function DraggableMedia({ id, item, children, className = '' }: {
  id: string; item: PlaylistItemInput; children: ReactNode; className?: string
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { item } })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
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

interface CtxValue { dragging: boolean }
const Ctx = createContext<CtxValue>({ dragging: false })
export const useCatalogDnd = () => useContext(Ctx)

// ── Provider : à mettre autour du contenu d'un module catalogue ──────────────
export function CatalogDndProvider({ children }: { children: ReactNode }) {
  const { currentUser, adminUnlocked } = useUser()
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<PlaylistItemInput | null>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [toast, setToast] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 1000, tolerance: 8 } }))

  const onStart = useCallback((e: DragStartEvent) => {
    setDragging(true)
    setPreview((e.active.data.current as any)?.item ?? null)
    api.playlists.list()
      .then(ls => setPlaylists(ls.filter(p => adminUnlocked || p.owner_user_id === currentUser?.id)))
      .catch(() => setPlaylists([]))
  }, [adminUnlocked, currentUser])

  const onEnd = useCallback(async (e: DragEndEvent) => {
    setDragging(false)
    const item = (e.active.data.current as any)?.item as PlaylistItemInput | undefined
    const overId = e.over?.id ? String(e.over.id) : ''
    setPreview(null)
    if (item && overId.startsWith('pl-')) {
      const plId = Number(overId.slice(3))
      const pl = playlists.find(p => p.id === plId)
      try {
        await api.playlists.addItem(plId, item)
        setPlaylists(prev => prev.map(p => p.id === plId ? { ...p, item_count: (p.item_count ?? 0) + 1 } : p))
        setToast(`Ajouté à « ${pl?.name ?? 'la playlist'} »`)
        setTimeout(() => setToast(null), 2500)
      } catch { /* */ }
    }
  }, [playlists])

  return (
    <Ctx.Provider value={{ dragging }}>
      <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => { setDragging(false); setPreview(null) }}>
        {children}

        {/* Dock playlists : visible uniquement pendant un drag */}
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

        {/* Aperçu suivant le curseur pendant le drag */}
        <DragOverlay dropAnimation={null}>
          {preview ? (
            <div className="flex items-center gap-2 bg-zinc-900 border border-amber-500/60 rounded-lg px-3 py-2 shadow-xl max-w-[220px]">
              <Plus size={14} className="text-amber-400 shrink-0" />
              <span className="text-sm truncate">{preview.title ?? 'Élément'}</span>
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
