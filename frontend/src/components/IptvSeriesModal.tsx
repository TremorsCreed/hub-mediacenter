import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, IptvSeriesInfo } from '../api'
import { useModalA11y } from '../useModalA11y'
import { ChevronDown, ChevronRight, Loader2, Play, X } from 'lucide-react'

export interface Props {
  credId: number
  seriesId: string
  /** Cover/thumb à afficher en attendant le chargement du detail. */
  coverFallback?: string
  /** Titre à afficher en attendant le chargement du detail. */
  titleFallback?: string
  /** Device cible pour le play. Vide → erreur "Sélectionne un device". */
  deviceId: string
  onClose: () => void
  /** Appelé après un play réussi. Le composant ferme automatiquement la modale. */
  onPlayed?: (toast: string) => void
  /** Erreur (string lisible) — typiquement passée à un setToast côté parent. */
  onError?: (msg: string) => void
}

export default function IptvSeriesModal({
  credId, seriesId, coverFallback, titleFallback, deviceId, onClose, onPlayed, onError,
}: Props) {
  const [detail, setDetail] = useState<IptvSeriesInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set([1]))
  const [launching, setLaunching] = useState<string | null>(null)
  const modalRef = useModalA11y(true, onClose)

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    api.iptv.seriesInfo(credId, seriesId)
      .then(setDetail)
      .catch((e: any) => onError?.(`Erreur série : ${e.message}`))
      .finally(() => setLoading(false))
  }, [credId, seriesId])

  const toggleSeason = (n: number) =>
    setOpenSeasons(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s })

  const playEpisode = async (epId: string, ext: string, title: string) => {
    if (!deviceId) { onError?.('Sélectionne un device'); return }
    setLaunching(`ep-${epId}`)
    try {
      const r = await api.play({
        iptv_stream_id: epId,
        iptv_type: 'series',
        iptv_ext: ext,
        title,
        thumb: coverFallback,
        app: 'iptv',
        device_id: deviceId,
        requester: 'manual',
      })
      onPlayed?.(`▶ ${r.title}`)
      onClose()
    } catch (e: any) {
      onError?.(e.message)
    } finally {
      setLaunching(null)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div ref={modalRef} className="bg-zinc-900/95 border border-zinc-700 rounded-lg max-w-3xl w-full my-8 relative shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 text-zinc-500 hover:text-white z-10">
          <X size={18} />
        </button>

        <div className="p-5 border-b border-zinc-800">
          <div className="flex gap-4">
            {(detail?.info.cover || coverFallback) && (
              <img
                src={api.iptv.imageUrl(detail?.info.cover || coverFallback)}
                alt={detail?.info.name ?? titleFallback ?? 'Série'}
                className="w-28 h-40 object-cover rounded shrink-0 bg-zinc-800"
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold leading-tight">
                {detail?.info.name ?? titleFallback ?? 'Série'}
              </h2>
              <div className="text-xs text-zinc-500 mt-1 flex gap-3 flex-wrap">
                {detail?.info.release_date && <span>{detail.info.release_date.slice(0, 4)}</span>}
                {detail?.info.genre && <span>{detail.info.genre}</span>}
                {detail?.info.rating && <span>★ {detail.info.rating}</span>}
              </div>
              {detail?.info.plot && (
                <p className="text-sm text-zinc-300 mt-3 line-clamp-4">{detail.info.plot}</p>
              )}
            </div>
          </div>
        </div>

        <div className="p-5">
          {loading && (
            <div className="flex items-center justify-center py-8 text-zinc-500 gap-2 text-sm">
              <Loader2 size={14} className="animate-spin" /> Chargement des épisodes…
            </div>
          )}
          {!loading && detail && detail.seasons.length === 0 && (
            <div className="text-sm text-zinc-600 py-6 text-center">Aucun épisode disponible.</div>
          )}
          {!loading && detail?.seasons.map(season => {
            const isOpen = openSeasons.has(season.season_number)
            return (
              <div key={season.season_number} className="border-t border-zinc-800 first:border-t-0">
                <button
                  onClick={() => toggleSeason(season.season_number)}
                  className="w-full flex items-center gap-2 py-3 text-left hover:text-amber-400 transition-colors"
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="font-medium">{season.name}</span>
                  <span className="text-xs text-zinc-500">
                    · {season.episode_count} épisode{season.episode_count > 1 ? 's' : ''}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-1 pb-3">
                    {season.episodes.map(ep => {
                      const busy = launching === `ep-${ep.episode_id}`
                      return (
                        <button
                          key={ep.episode_id}
                          onClick={() => playEpisode(
                            ep.episode_id,
                            ep.container_extension,
                            `${detail?.info.name ?? titleFallback ?? 'Série'} — S${season.season_number}E${ep.episode_num} ${ep.title}`,
                          )}
                          disabled={busy}
                          className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-zinc-800 text-left disabled:opacity-50 transition-colors"
                        >
                          <div className="text-xs text-zinc-500 w-12 shrink-0">
                            S{season.season_number}E{ep.episode_num}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{ep.title}</div>
                            {ep.air_date && <div className="text-[11px] text-zinc-600">{ep.air_date}</div>}
                          </div>
                          {busy
                            ? <Loader2 size={14} className="animate-spin text-amber-400" />
                            : <Play size={12} className="text-zinc-600" fill="currentColor" />
                          }
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
