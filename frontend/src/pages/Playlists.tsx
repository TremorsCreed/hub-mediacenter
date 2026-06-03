import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, Playlist } from '../api'
import { useUser } from '../UserContext'
import { ListVideo, Plus, Users, Lock, X, Loader2, Download } from 'lucide-react'

export default function Playlists() {
  const { currentUser } = useUser()
  const navigate = useNavigate()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = () => api.playlists.list().then(setPlaylists).catch(() => {})
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const r = await api.playlists.create({ name: name.trim(), is_shared: shared })
      setCreating(false); setName(''); setShared(false)
      navigate(`/playlists/${r.id}`)
    } catch { /* */ } finally { setSaving(false) }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold mr-auto">Playlists</h1>
        <button
          onClick={() => navigate('/playlists/import')}
          className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 text-sm rounded px-3 py-1.5 hover:border-zinc-500 transition-colors"
        >
          <Download size={15} /> Importer
        </button>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 bg-amber-500 text-black text-sm font-medium rounded px-3 py-1.5 hover:bg-amber-400 transition-colors"
        >
          <Plus size={15} /> Nouvelle playlist
        </button>
      </div>

      {playlists.length === 0 && (
        <div className="text-sm text-zinc-600 bg-zinc-900/50 border border-zinc-800 rounded-lg py-12 text-center">
          Aucune playlist. Crée-en une, ou importe une liste (ex. Chronologie MCU).
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {playlists.map(pl => (
          <button
            key={pl.id}
            onClick={() => navigate(`/playlists/${pl.id}`)}
            className="group text-left bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-amber-500/60 transition-colors"
          >
            <div className="relative aspect-[16/7] bg-zinc-800 flex items-center justify-center overflow-hidden">
              {pl.cover
                ? <img src={pl.cover} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                : <ListVideo size={32} className="text-zinc-700" />}
              <div className="absolute top-2 right-2">
                {pl.is_shared
                  ? <span className="flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] text-cyan-300"><Users size={10} /> Partagée</span>
                  : <span className="flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] text-zinc-400"><Lock size={10} /> Perso</span>}
              </div>
            </div>
            <div className="p-3">
              <div className="text-sm font-medium truncate">{pl.name}</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {pl.item_count ?? 0} élément{(pl.item_count ?? 0) > 1 ? 's' : ''}
                {pl.owner_user_id !== currentUser?.id && pl.owner_name ? ` · ${pl.owner_name}` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>

      {creating && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCreating(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-sm p-5 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setCreating(false)} className="absolute top-3 right-3 text-zinc-500 hover:text-white"><X size={18} /></button>
            <h2 className="text-base font-semibold mb-4">Nouvelle playlist</h2>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create() }}
              placeholder="Nom de la playlist"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
            />
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" className="accent-amber-500" checked={shared} onChange={e => setShared(e.target.checked)} />
              <span className="text-sm text-zinc-200">Partagée avec toute la famille</span>
            </label>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setCreating(false)} className="text-sm text-zinc-400 hover:text-zinc-200 px-3 py-2">Annuler</button>
              <button onClick={create} disabled={!name.trim() || saving} className="flex items-center gap-2 bg-amber-500 text-black text-sm font-medium rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
