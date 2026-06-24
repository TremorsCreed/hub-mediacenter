import { useState } from 'react'
import { createPortal } from 'react-dom'
import { api, Playlist, PlaylistItemInput } from '../api'
import { useUser } from '../UserContext'
import { useModalA11y } from '../useModalA11y'
import { ListPlus, Plus, Loader2, Check, X, ListVideo, Star } from 'lucide-react'

// Bouton + modale pour ajouter un contenu à une playlist (existante ou nouvelle).
export default function AddToPlaylist({ item, className = '' }: { item: PlaylistItemInput; className?: string }) {
  const { currentUser, adminUnlocked } = useUser()
  const [open, setOpen] = useState(false)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [addedTo, setAddedTo] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const modalRef = useModalA11y(open, () => setOpen(false))
  const defaultId = currentUser?.default_playlist_id ?? null

  const openModal = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setOpen(true); setAddedTo(null); setNewName('')
    setLoading(true)
    api.playlists.list()
      .then(ls => {
        const visible = ls.filter(p => adminUnlocked || p.owner_user_id === currentUser?.id)
        // La playlist par défaut du profil passe en tête (ajout en un clic).
        visible.sort((a, b) => (a.id === defaultId ? -1 : 0) - (b.id === defaultId ? -1 : 0))
        setPlaylists(visible)
      })
      .catch(() => setPlaylists([]))
      .finally(() => setLoading(false))
  }

  const addTo = async (pl: Playlist) => {
    setBusyId(pl.id)
    try {
      await api.playlists.addItem(pl.id, item)
      setAddedTo(pl.id)
      setTimeout(() => setOpen(false), 700)
    } catch { /* silencieux */ } finally { setBusyId(null) }
  }

  const createAndAdd = async () => {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const r = await api.playlists.create({ name: newName.trim() })
      await api.playlists.addItem(r.id, item)
      setAddedTo(r.id)
      setTimeout(() => setOpen(false), 700)
    } catch { /* silencieux */ } finally { setCreating(false) }
  }

  return (
    <>
      <button
        onClick={openModal}
        title="Ajouter à une playlist"
        className={`tap-target flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm hover:bg-black/75 transition-colors ${className}`}
      >
        <ListPlus size={14} className="text-white/90" strokeWidth={2} />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => { e.stopPropagation(); setOpen(false) }}>
          <div ref={modalRef} className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-sm p-4 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="absolute top-3 right-3 text-zinc-500 hover:text-white"><X size={18} /></button>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><ListVideo size={16} className="text-amber-400" /> Ajouter à une playlist</h3>
            {item.title && <p className="text-xs text-zinc-500 mb-3 truncate">« {item.title} »</p>}

            {loading ? (
              <div className="py-6 flex justify-center text-zinc-500"><Loader2 size={18} className="animate-spin" /></div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {playlists.map(pl => {
                  const isDefault = pl.id === defaultId
                  return (
                  <button
                    key={pl.id}
                    onClick={() => addTo(pl)}
                    disabled={busyId === pl.id}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-zinc-800 text-left transition-colors"
                  >
                    {isDefault
                      ? <Star size={14} className="text-amber-400 fill-current shrink-0" />
                      : <ListVideo size={14} className="text-zinc-500 shrink-0" />}
                    <span className="flex-1 min-w-0 text-sm truncate">{pl.name}</span>
                    {isDefault && busyId !== pl.id && addedTo !== pl.id && <span className="text-[10px] text-amber-400/80 shrink-0">Par défaut</span>}
                    <span className="text-[10px] text-zinc-600">{pl.item_count ?? 0}</span>
                    {addedTo === pl.id ? <Check size={15} className="text-green-500" /> : busyId === pl.id ? <Loader2 size={14} className="animate-spin text-amber-400" /> : null}
                  </button>
                  )
                })}
                {playlists.length === 0 && <div className="text-xs text-zinc-600 px-3 py-2">Aucune playlist modifiable.</div>}
              </div>
            )}

            <div className="border-t border-zinc-800 mt-3 pt-3 flex items-center gap-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createAndAdd() }}
                placeholder="Nouvelle playlist…"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500/60"
              />
              <button onClick={createAndAdd} disabled={!newName.trim() || creating} className="flex items-center gap-1 bg-amber-500 text-black text-sm font-medium rounded px-3 py-1.5 hover:bg-amber-400 disabled:opacity-50">
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
