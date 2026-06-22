import { useRef, useState } from 'react'
import { api, Playlist } from '../api'
import { X, Loader2, Image as ImageIcon, Upload, Link2, Trash2 } from 'lucide-react'

// Redimensionne une image (fichier) en data URL JPEG compacte, pour la stocker
// directement dans la colonne `cover` sans avoir besoin d'un stockage d'images dédié.
async function fileToCover(file: File, maxW = 640): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = url
    })
    const scale = Math.min(1, maxW / img.width)
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Édition des métadonnées d'une playlist : nom, description et vignette (cover).
// La vignette accepte une URL ou un fichier image (redimensionné en data URL).
export default function EditPlaylistModal({ playlist, onClose, onDone }: {
  playlist: Playlist; onClose: () => void; onDone: () => void
}) {
  const [name, setName] = useState(playlist.name)
  const [description, setDescription] = useState(playlist.description ?? '')
  const [cover, setCover] = useState(playlist.cover ?? '')
  const [saving, setSaving] = useState(false)
  const [loadingImg, setLoadingImg] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permet de re-choisir le même fichier
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Choisis un fichier image.'); return }
    setError(null); setLoadingImg(true)
    try {
      setCover(await fileToCover(file))
    } catch {
      setError('Impossible de lire cette image.')
    } finally { setLoadingImg(false) }
  }

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true); setError(null)
    try {
      await api.playlists.update(playlist.id, {
        name: name.trim(),
        description: description.trim() || null,
        cover: cover.trim() || null,
      })
      onDone(); onClose()
    } catch (e: any) {
      setError(e.message || 'Échec de l\'enregistrement')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-lg mt-10 mb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h3 className="font-semibold">Modifier la playlist</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Vignette */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-widest">Vignette</label>
            <div className="mt-2 flex gap-4">
              <div className="w-44 aspect-[16/9] rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                {cover
                  ? <img src={cover} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                  : <ImageIcon size={26} className="text-zinc-700" />}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <button onClick={() => fileRef.current?.click()} disabled={loadingImg}
                  className="w-full flex items-center justify-center gap-2 bg-zinc-800 border border-zinc-700 text-sm rounded px-3 py-2 hover:border-zinc-500 disabled:opacity-50">
                  {loadingImg ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Importer une image
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
                <div className="relative">
                  <Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={cover.startsWith('data:') ? '' : cover}
                    onChange={e => setCover(e.target.value)}
                    placeholder={cover.startsWith('data:') ? 'Image importée' : 'ou colle une URL d\'image…'}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
                  />
                </div>
                {cover && (
                  <button onClick={() => setCover('')} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-400 transition-colors">
                    <Trash2 size={12} /> Retirer la vignette
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Nom */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-widest">Nom</label>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={120}
              className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60" />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-widest">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60 resize-none" />
          </div>

          {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded p-2.5">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="text-sm text-zinc-400 hover:text-zinc-200 px-4 py-2">Annuler</button>
            <button onClick={save} disabled={!name.trim() || saving || loadingImg}
              className="flex items-center gap-2 bg-amber-500 text-black font-medium rounded-lg px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
