import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, IptvStream, IptvVodInfo } from '../api'
import { X, Play, Film, Star, Clock, Calendar, Loader2 } from 'lucide-react'
import FavoriteButton from './FavoriteButton'
import WatchedButton from './WatchedButton'
import AddToPlaylist from './AddToPlaylist'
import { useModalA11y } from '../useModalA11y'

// Extrait l'ID YouTube d'un champ trailer (ID brut ou URL).
function ytId(t: string): string | null {
  if (!t) return null
  const m = t.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/) || t.match(/^([\w-]{11})$/)
  return m ? m[1] : null
}

// Fiche film façon Plex : ouverte au clic sur une carte VOD (au lieu de lancer
// directement → évite les lancements accidentels, notamment sur mobile). Le Play
// est un geste explicite. Synopsis / casting / note / bande-annonce via get_vod_info.
export default function VodDetail({ credId, stream, deviceName, onPlay, onClose }: {
  credId: number
  stream: IptvStream
  deviceName?: string
  onPlay: () => void
  onClose: () => void
}) {
  const [info, setInfo] = useState<IptvVodInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [trailer, setTrailer] = useState(false)
  const modalRef = useModalA11y(true, onClose)

  useEffect(() => {
    setLoading(true)
    api.iptv.vodInfo(credId, stream.stream_id)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false))
  }, [credId, stream.stream_id])

  const title = info?.name || stream.name
  const cover = info?.cover || stream.logo
  const yt = info ? ytId(info.trailer) : null

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center sm:p-4" onClick={onClose}>
      <div
        ref={modalRef}
        className="relative bg-zinc-950 w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-xl overflow-hidden flex flex-col border border-zinc-800 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Flou gaussien du backdrop derrière toute la fiche (façon Plex) */}
        {(info?.backdrop || cover) && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={api.iptv.imageUrl(info?.backdrop || cover)} alt=""
              className="w-full h-full object-cover"
              style={{ transform: 'scale(1.35)', filter: 'blur(36px)' }}
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
            {/* Voile dégradé : backdrop bien visible en haut, plus sombre vers le bas
                (zone texte) pour garder la lisibilité du synopsis. */}
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/40 via-zinc-950/55 to-zinc-950/85" />
          </div>
        )}

        {/* Backdrop net en haut (se fond dans le flou) */}
        <div className="relative h-40 sm:h-56 shrink-0">
          {info?.backdrop && (
            <img src={api.iptv.imageUrl(info.backdrop)} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
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
              {cover
                ? <img src={api.iptv.imageUrl(cover)} alt={title} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Film size={28} /></div>}
            </div>

            <div className="flex-1 min-w-0 pt-12 sm:pt-16">
              <h2 className="text-lg sm:text-2xl font-bold text-white leading-tight">{title}</h2>
              {info?.o_name && info.o_name !== title && <div className="text-xs text-zinc-500 mt-0.5 italic">{info.o_name}</div>}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-zinc-400">
                {info?.year && <span className="flex items-center gap-1"><Calendar size={12} /> {info.year}</span>}
                {info?.duration && <span className="flex items-center gap-1"><Clock size={12} /> {info.duration}</span>}
                {info?.rating ? <span className="flex items-center gap-1 text-amber-400"><Star size={12} fill="currentColor" /> {info.rating.toFixed(1)}</span> : null}
              </div>
              {info?.genre && <div className="mt-1.5 flex flex-wrap gap-1">{info.genre.split(/[,/]/).slice(0, 4).map((g, i) => <span key={i} className="text-[10px] bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5">{g.trim()}</span>)}</div>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button onClick={onPlay} data-autofocus
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg px-5 py-2.5 transition-colors">
              <Play size={18} fill="currentColor" /> Lancer{deviceName ? <span className="font-normal text-black/70 text-sm">· {deviceName}</span> : null}
            </button>
            {yt && (
              <button onClick={() => setTrailer(t => !t)}
                className="flex items-center gap-1.5 border border-zinc-700 hover:border-zinc-500 text-zinc-200 rounded-lg px-3 py-2.5 transition-colors text-sm">
                <Film size={15} /> Bande-annonce
              </button>
            )}
            <FavoriteButton fav={{ app: 'iptv', ref_id: stream.stream_id, ref_type: 'vod', title, thumb: cover }} className="w-10 h-10 border border-zinc-700 rounded-lg" />
            <WatchedButton item={{ app: 'iptv', ref_id: stream.stream_id, ref_type: 'vod', title, thumb: cover }} className="w-10 h-10 border border-zinc-700 rounded-lg" />
            <AddToPlaylist item={{ app: 'iptv', ref_id: stream.stream_id, ref_type: 'vod', title, thumb: cover }} className="w-10 h-10 border border-zinc-700 rounded-lg" />
          </div>

          {/* Bande-annonce (embed) */}
          {trailer && yt && (
            <div className="mt-4 aspect-video rounded-lg overflow-hidden bg-black">
              <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${yt}?autoplay=1`} title="Bande-annonce" allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
            </div>
          )}

          {/* Synopsis + casting */}
          {loading
            ? <div className="flex items-center gap-2 text-sm text-zinc-500 mt-5"><Loader2 size={14} className="animate-spin" /> Chargement de la fiche…</div>
            : <div className="mt-5 space-y-3">
                {info?.plot && <p className="text-sm text-zinc-300 leading-relaxed">{info.plot}</p>}
                {info?.cast && <div className="text-xs text-zinc-500"><span className="text-zinc-400 font-medium">Avec </span>{info.cast}</div>}
                {info?.director && <div className="text-xs text-zinc-500"><span className="text-zinc-400 font-medium">Réalisation </span>{info.director}</div>}
                {info?.country && <div className="text-xs text-zinc-600">{info.country}</div>}
              </div>}
        </div>
      </div>
    </div>,
    document.body
  )
}
