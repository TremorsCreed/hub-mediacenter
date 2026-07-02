import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, PlexItem, PlexMovieInfo } from '../api'
import { X, Play, Film, Star, Clock, Calendar, Loader2, RotateCcw } from 'lucide-react'
import FavoriteButton from './FavoriteButton'
import WatchedButton from './WatchedButton'
import AddToPlaylist from './AddToPlaylist'
import { useModalA11y } from '../useModalA11y'

function fmtDuration(ms?: number): string {
  if (!ms) return ''
  const min = Math.round(ms / 60000)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

// Fiche film Plex : même expérience que VodDetail côté IPTV — le clic sur une carte
// ouvre l'aperçu (synopsis / casting / note), le lancement est un geste explicite
// (anti-lancement accidentel, notamment sur mobile). Spécificité Plex : la reprise
// (viewOffset) donne deux gestes distincts, Reprendre et Du début.
export default function PlexMovieDetail({ item, deviceName, onPlay, onClose }: {
  item: PlexItem
  deviceName?: string
  onPlay: (resume: boolean) => void
  onClose: () => void
}) {
  const [info, setInfo] = useState<PlexMovieInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const modalRef = useModalA11y(true, onClose)

  useEffect(() => {
    setLoading(true)
    api.plex.movieInfo(item.ratingKey)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false))
  }, [item.ratingKey])

  const title = info?.title || item.title
  const thumb = info?.thumb || item.thumb
  const art = info?.art || item.art
  const year = info?.year ?? item.year
  const rating = info?.rating ?? item.rating
  const duration = info?.duration ?? item.duration
  const inProgress = (info?.viewOffset ?? item.viewOffset ?? 0) > 0

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center sm:p-4" onClick={onClose}>
      <div
        ref={modalRef}
        className="relative bg-zinc-950 w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-xl overflow-hidden flex flex-col border border-zinc-800 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Flou gaussien du backdrop derrière toute la fiche (même recette que VodDetail) */}
        {(art || thumb) && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={api.plex.imageUrl(art || thumb)} alt=""
              className="w-full h-full object-cover"
              style={{ transform: 'scale(1.35)', filter: 'blur(36px)' }}
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/40 via-zinc-950/55 to-zinc-950/85" />
          </div>
        )}

        {/* Backdrop net en haut (se fond dans le flou) */}
        <div className="relative h-40 sm:h-56 shrink-0">
          {art && (
            <img src={api.plex.imageUrl(art)} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />
          <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 -mt-16 sm:-mt-20 relative">
          <div className="flex gap-4">
            {/* Jaquette */}
            <div className="w-24 sm:w-32 shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700 shadow-lg">
              {thumb
                ? <img src={api.plex.imageUrl(thumb)} alt={title} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Film size={28} /></div>}
            </div>

            <div className="flex-1 min-w-0 pt-12 sm:pt-16">
              <h2 className="text-lg sm:text-2xl font-bold text-white leading-tight">{title}</h2>
              {info?.originalTitle && info.originalTitle !== title && <div className="text-xs text-zinc-500 mt-0.5 italic">{info.originalTitle}</div>}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-zinc-400">
                {year && <span className="flex items-center gap-1"><Calendar size={12} /> {year}</span>}
                {duration ? <span className="flex items-center gap-1"><Clock size={12} /> {fmtDuration(duration)}</span> : null}
                {rating ? <span className="flex items-center gap-1 text-amber-400"><Star size={12} fill="currentColor" /> {rating.toFixed(1)}</span> : null}
                {info?.contentRating && <span className="border border-zinc-700 rounded px-1 py-px text-[10px]">{info.contentRating}</span>}
              </div>
              {info && info.genres.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {info.genres.slice(0, 4).map((g, i) => <span key={i} className="text-[10px] bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5">{g}</span>)}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button onClick={() => onPlay(inProgress)} data-autofocus
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg px-5 py-2.5 transition-colors">
              {inProgress
                ? <><RotateCcw size={18} /> Reprendre</>
                : <><Play size={18} fill="currentColor" /> Lancer</>}
              {deviceName ? <span className="font-normal text-black/70 text-sm">· {deviceName}</span> : null}
            </button>
            {inProgress && (
              <button onClick={() => onPlay(false)}
                className="flex items-center gap-1.5 border border-zinc-700 hover:border-zinc-500 text-zinc-200 rounded-lg px-3 py-2.5 transition-colors text-sm">
                <Play size={15} fill="currentColor" /> Du début
              </button>
            )}
            <FavoriteButton fav={{ app: 'plex', ref_id: item.ratingKey, ref_type: item.type, title, thumb }} className="w-10 h-10 border border-zinc-700 rounded-lg" />
            <WatchedButton item={{ app: 'plex', ref_id: item.ratingKey, ref_type: item.type, title, thumb }} className="w-10 h-10 border border-zinc-700 rounded-lg" />
            <AddToPlaylist item={{ app: 'plex', ref_id: item.ratingKey, ref_type: item.type, title, thumb, year }} className="w-10 h-10 border border-zinc-700 rounded-lg" />
          </div>

          {/* Synopsis + casting */}
          {loading
            ? <div className="flex items-center gap-2 text-sm text-zinc-500 mt-5"><Loader2 size={14} className="animate-spin" /> Chargement de la fiche…</div>
            : <div className="mt-5 space-y-3">
                {info?.tagline && <p className="text-sm text-zinc-400 italic">{info.tagline}</p>}
                {(info?.summary || item.summary) && <p className="text-sm text-zinc-300 leading-relaxed">{info?.summary || item.summary}</p>}
                {info && info.cast.length > 0 && <div className="text-xs text-zinc-500"><span className="text-zinc-400 font-medium">Avec </span>{info.cast.join(', ')}</div>}
                {info && info.directors.length > 0 && <div className="text-xs text-zinc-500"><span className="text-zinc-400 font-medium">Réalisation </span>{info.directors.join(', ')}</div>}
                {info && info.countries.length > 0 && <div className="text-xs text-zinc-600">{info.countries.join(', ')}</div>}
              </div>}
        </div>
      </div>
    </div>,
    document.body
  )
}
