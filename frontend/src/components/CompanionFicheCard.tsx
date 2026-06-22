import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  api, CompanionCandidate, CompanionFiche, CompanionInboxItem, CompanionMatch,
  Playlist, PlaylistItemInput,
} from '../api'
import { useUser } from '../UserContext'
import { useModalA11y } from '../useModalA11y'
import {
  X, Loader2, Play, Star, Film, Tv, CheckCircle2, AlertCircle, Heart, EyeOff,
  ListVideo, Plus, HelpCircle, ExternalLink, Search, RefreshCw,
} from 'lucide-react'

// Couleur du badge de confiance.
const CONF: Record<string, { label: string; cls: string }> = {
  high:   { label: 'Confiance haute',   cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-700/50' },
  medium: { label: 'Confiance moyenne', cls: 'bg-amber-500/15 text-amber-300 border-amber-700/50' },
  low:    { label: 'Confiance faible',  cls: 'bg-zinc-500/15 text-zinc-300 border-zinc-600/50' },
}

// Couleurs plateformes streaming (réutilise l'esprit de Discover).
function platformLabel(p: string) {
  const map: Record<string, string> = {
    netflix: 'Netflix', 'disney+': 'Disney+', disneyplus: 'Disney+',
    primevideo: 'Prime Video', amazon: 'Prime Video', appletvplus: 'Apple TV+',
    max: 'Max', 'paramount+': 'Paramount+', youtube: 'YouTube',
  }
  return map[p.toLowerCase()] ?? p
}

// Fiche média réutilisable, affichée en modale depuis Découvertes.
// `item` porte les candidats ; après une action finale, on remonte la décision.
export default function CompanionFicheCard({
  item, onClose, onDecided, context = 'inbox', deviceId,
}: {
  item: CompanionInboxItem
  onClose: () => void
  onDecided: (action: 'validated' | 'wishlist' | 'ignored') => void
  // 'inbox' = item réel (Wishlist/Ignorer/Rescan) ; 'detail' = item synthétique (lecture seule).
  context?: 'inbox' | 'detail'
  // Device cible pour les boutons de lecture (Plex / IPTV). Sans device : lecture désactivée.
  deviceId?: string | null
}) {
  const isInbox = context === 'inbox'
  const { currentUser } = useUser()
  // Candidats en state local : on peut y injecter des résultats de recherche manuelle.
  const [candidates, setCandidates] = useState<CompanionCandidate[]>(item.candidates ?? [])
  const [candIdx, setCandIdx] = useState(0)
  const candidate: CompanionCandidate | undefined = candidates[candIdx]

  // Ajoute un candidat trouvé manuellement (ou le sélectionne s'il existe déjà) puis le charge.
  const pickManual = (c: CompanionCandidate) => {
    setCandidates(prev => {
      const idx = prev.findIndex(p =>
        p.type === c.type &&
        (p.ids?.imdb === c.ids?.imdb || p.ids?.tmdb === c.ids?.tmdb || p.ids?.trakt === c.ids?.trakt) &&
        p.title === c.title && p.year === c.year,
      )
      if (idx >= 0) { setCandIdx(idx); return prev }
      const next = [...prev, c]
      setCandIdx(next.length - 1)
      return next
    })
  }

  const [fiche, setFiche] = useState<CompanionFiche | null>(null)
  const [loadingFiche, setLoadingFiche] = useState(false)
  const [match, setMatch] = useState<CompanionMatch | null>(null)
  const [loadingMatch, setLoadingMatch] = useState(false)
  const [showTrailer, setShowTrailer] = useState(false)
  const [deciding, setDeciding] = useState<null | 'validated' | 'wishlist' | 'ignored'>(null)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playMsg, setPlayMsg] = useState<string | null>(null)

  const modalRef = useModalA11y(true, onClose)

  // Charge la fiche + la disponibilité dès qu'on change de candidat.
  useEffect(() => {
    if (!candidate) return
    setShowTrailer(false)
    setFiche(null); setMatch(null)
    const hasId = !!(candidate.ids && (candidate.ids.imdb || candidate.ids.tmdb || candidate.ids.trakt))
    // Candidat titre-seul (consensus sans match Trakt) : pas d'id pour charger /fiche.
    // On cherche le titre sur Trakt pour obtenir de vrais candidats (avec ids) et on
    // sélectionne le 1er résultat, ce qui relance ce useEffect avec un id chargeable.
    if (!hasId) {
      const q = candidate.title
      if (!q) { setLoadingMatch(false); return }
      setLoadingFiche(true); setLoadingMatch(false)
      api.companion.search(q)
        .then(list => {
          if (!list || !list.length) return
          const same = (a: CompanionCandidate, b: CompanionCandidate) =>
            a.title === b.title && a.year === b.year &&
            ((a.ids?.imdb && a.ids?.imdb === b.ids?.imdb) ||
             (a.ids?.tmdb && a.ids?.tmdb === b.ids?.tmdb) ||
             (a.ids?.trakt && a.ids?.trakt === b.ids?.trakt))
          setCandidates(prev => {
            const merged = [...prev, ...list.filter(r => !prev.some(c => same(c, r)))]
            const idx = merged.findIndex(c => same(c, list[0]))
            if (idx >= 0) setCandIdx(idx)
            return merged
          })
        })
        .catch(() => {})
        .finally(() => setLoadingFiche(false))
      return
    }
    setLoadingFiche(true); setLoadingMatch(true)
    api.companion.fiche({ type: candidate.type, ids: candidate.ids })
      .then(f => {
        setFiche(f)
        return api.companion.match({ title: f.title, year: f.year, type: candidate.type, ids: candidate.ids })
          .then(setMatch)
          .catch(() => setMatch(null))
          .finally(() => setLoadingMatch(false))
      })
      .catch(() => { setFiche(null); setLoadingMatch(false) })
      .finally(() => setLoadingFiche(false))
  }, [candIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (action: 'validated' | 'wishlist' | 'ignored') => {
    setDeciding(action)
    try { await api.companion.decide(item.id, action); onDecided(action) }
    catch { setDeciding(null) }
  }

  // Rescan (inbox réel) : re-tente la résolution, réinjecte les candidats, resélectionne le 1er.
  const rescan = async () => {
    if (rescanning) return
    setRescanning(true)
    try {
      const r = await api.companion.rescan(item.id)
      const next = r.candidates ?? []
      if (next.length > 0) { setCandidates(next); setCandIdx(0) }
    } catch { /* on garde l'état courant en cas d'échec */ }
    finally { setRescanning(false) }
  }

  // Lecture depuis la fiche : nécessite un device cible.
  const flashPlay = (msg: string) => { setPlayMsg(msg); setTimeout(() => setPlayMsg(null), 3000) }
  const playPlex = async (ratingKey: string) => {
    if (!deviceId) { flashPlay('Choisis un device') ; return }
    setPlaying(true)
    try {
      const pr = await api.play({ plex_id: ratingKey, title: fiche?.title, thumb: fiche?.poster ?? undefined, app: 'plex', device_id: deviceId, requester: 'manual' })
      flashPlay(`▶ ${pr.title}`)
    } catch (e: any) { flashPlay(`Échec : ${e.message}`) }
    finally { setPlaying(false) }
  }
  const playIptv = async (hit: { streamId: string; kind: 'vod' | 'series'; language: string | null }) => {
    if (!deviceId) { flashPlay('Choisis un device') ; return }
    setPlaying(true)
    try {
      const pr = await api.play({ iptv_stream_id: hit.streamId, iptv_type: hit.kind, title: fiche?.title, thumb: fiche?.poster ?? undefined, app: 'iptv', device_id: deviceId, requester: 'manual' })
      flashPlay(`▶ ${pr.title}${hit.language ? ` (${hit.language})` : ''}`)
    } catch (e: any) { flashPlay(`Échec : ${e.message}`) }
    finally { setPlaying(false) }
  }

  const isSeries = (candidate?.type ?? '') === 'series'

  // Item de playlist construit depuis le match (catalogue) ou la fiche (repli).
  const playlistItem: PlaylistItemInput | null = match?.item
    ?? (fiche ? { app: 'catalog', title: fiche.title, year: fiche.year ?? undefined, thumb: fiche.poster ?? undefined, status: 'missing' as const } : null)

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={modalRef}
        className="bg-zinc-900/95 border border-zinc-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 relative shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 right-3 text-zinc-500 hover:text-white transition-colors"><X size={18} /></button>

        {/* Sélecteur de candidat (autres pistes) + recherche manuelle */}
        {candidates.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3 flex-wrap pr-6">
            {candidates.length > 1 && (
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Autres pistes :</span>
            )}
            {candidates.length > 1 && candidates.map((c, i) => (
              <button
                key={i}
                onClick={() => setCandIdx(i)}
                className={`text-xs rounded px-2 py-0.5 transition-colors ${i === candIdx ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
              >
                {c.title ?? `Piste ${i + 1}`}{c.year ? ` (${c.year})` : ''}
              </button>
            ))}
            <button
              onClick={() => setShowSearch(v => !v)}
              className="text-xs text-zinc-400 hover:text-amber-300 inline-flex items-center gap-1 transition-colors"
            >
              <Search size={12} /> Pas le bon ? Rechercher
            </button>
          </div>
        )}

        {/* Champ de recherche manuelle accessible quand il y a déjà des candidats */}
        {candidates.length > 0 && showSearch && (
          <div className="mb-4">
            <ManualSearch onPick={c => { pickManual(c); setShowSearch(false) }} />
          </div>
        )}

        {/* Repli : aucun candidat résolu automatiquement. On montre ce qu'on a du
            partage (vignette / légende / auteur / lien) plutôt qu'un cul-de-sac. */}
        {candidates.length === 0 && (
          <div>
            <div className="flex gap-4">
              {(item.thumbnail ?? item.thumb)
                ? <img src={(item.thumbnail ?? item.thumb)!} alt="" className="w-32 h-48 object-cover rounded shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
                : <div className="w-32 h-48 rounded shrink-0 bg-zinc-800 flex items-center justify-center text-zinc-600"><HelpCircle size={28} /></div>}
              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-700/40 rounded px-2 py-1">
                  <HelpCircle size={13} /> Titre non identifié automatiquement.
                </div>
                {(item.title_guess ?? item.resolved_title) && (
                  <div className="text-sm text-zinc-300 mt-3">Piste : <span className="text-zinc-100">{item.title_guess ?? item.resolved_title}</span></div>
                )}
                {(item.author_name ?? item.author) && (
                  <div className="text-xs text-zinc-400 mt-2">Auteur : <span className="text-zinc-200">{item.author_name ?? item.author}</span></div>
                )}
                {item.source_url && (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-white rounded px-3 py-1.5 transition-colors"
                  >
                    <ExternalLink size={13} /> Voir sur TikTok
                  </a>
                )}
              </div>
            </div>

            {item.caption && <p className="text-sm text-zinc-300 mt-4 leading-relaxed whitespace-pre-line">{item.caption}</p>}

            {/* Recherche manuelle : l'utilisateur tape le titre vu dans la vidéo. */}
            <div className="mt-5 pt-4 border-t border-zinc-800">
              <ManualSearch onPick={pickManual} />
            </div>

            {/* Actions : on garde Rescan + Wishlist + Ignorer même sans fiche (inbox réel uniquement). */}
            {isInbox && (
            <div className="mt-6 pt-4 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
              <button
                onClick={rescan}
                disabled={rescanning || deciding !== null}
                title="Relancer la résolution du titre avec l'algo courant"
                className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 px-3 py-1.5 rounded transition-colors"
              >
                {rescanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rescanner
              </button>
              <button
                onClick={() => decide('wishlist')}
                disabled={deciding !== null}
                className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 px-3 py-1.5 rounded transition-colors"
              >
                {deciding === 'wishlist' ? <Loader2 size={13} className="animate-spin" /> : <Heart size={13} />} Wishlist
              </button>
              <button
                onClick={() => decide('ignored')}
                disabled={deciding !== null}
                className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-40 px-3 py-1.5 transition-colors ml-auto"
              >
                {deciding === 'ignored' ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />} Ignorer
              </button>
            </div>
            )}
          </div>
        )}

        {candidates.length > 0 && loadingFiche && (
          <div className="py-16 flex justify-center text-zinc-500"><Loader2 size={20} className="animate-spin" /></div>
        )}

        {candidates.length > 0 && !loadingFiche && !fiche && (
          <div className="py-12 text-center text-sm text-zinc-600">Aucune fiche pour ce titre. Utilise « Rechercher » ci-dessus pour le retrouver.</div>
        )}

        {fiche && (
          <>
            <div className="flex gap-4">
              {fiche.poster
                ? <img src={fiche.poster} alt={fiche.title} className="w-32 h-48 object-cover rounded shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
                : <div className="w-32 h-48 rounded shrink-0 bg-zinc-800 flex items-center justify-center text-zinc-600">{isSeries ? <Tv size={28} /> : <Film size={28} />}</div>}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold leading-tight">{fiche.title}</h2>
                  {fiche.year && <span className="text-sm text-zinc-500">({fiche.year})</span>}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500 flex-wrap">
                  <span className="flex items-center gap-1">{isSeries ? <Tv size={11} /> : <Film size={11} />}{isSeries ? 'Série' : 'Film'}</span>
                  {fiche.rating != null && <span className="flex items-center gap-1 text-amber-400"><Star size={11} fill="currentColor" />{fiche.rating.toFixed(1)}</span>}
                  {candidate?.confidence && (
                    <span className={`border rounded px-1.5 py-0.5 ${CONF[candidate.confidence]?.cls ?? CONF.low.cls}`}>{CONF[candidate.confidence]?.label}</span>
                  )}
                </div>
                {fiche.director && <div className="text-xs text-zinc-400 mt-2">Réalisation : <span className="text-zinc-200">{fiche.director}</span></div>}
                {fiche.cast && fiche.cast.length > 0 && <div className="text-xs text-zinc-400 mt-1">Avec : <span className="text-zinc-200">{fiche.cast.slice(0, 4).join(', ')}</span></div>}
                {fiche.genres && fiche.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {fiche.genres.slice(0, 4).map(g => <span key={g} className="text-[10px] bg-zinc-800 text-zinc-400 rounded px-1.5 py-0.5">{g}</span>)}
                  </div>
                )}
                {fiche.trailer_youtube_key && (
                  <button
                    onClick={() => setShowTrailer(v => !v)}
                    className="mt-3 flex items-center gap-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded px-3 py-1.5 transition-colors"
                  >
                    <Play size={13} fill="currentColor" /> {showTrailer ? 'Masquer la bande-annonce' : 'Bande-annonce'}
                  </button>
                )}
              </div>
            </div>

            {fiche.synopsis && <p className="text-sm text-zinc-300 mt-4 leading-relaxed">{fiche.synopsis}</p>}

            {/* Lecteur YouTube embarqué */}
            {showTrailer && fiche.trailer_youtube_key && (
              <div className="mt-4 aspect-video w-full rounded overflow-hidden border border-zinc-800">
                <iframe
                  className="w-full h-full"
                  src={`https://www.youtube.com/embed/${fiche.trailer_youtube_key}?autoplay=1`}
                  title="Bande-annonce"
                  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            {/* Disponibilité */}
            <div className="mt-5">
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Disponibilité</div>
              {loadingMatch && <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin" /> Recherche…</div>}
              {!loadingMatch && match && <AvailabilityBadge match={match} />}
              {!loadingMatch && !match && <div className="text-sm text-zinc-600">Disponibilité inconnue.</div>}

              {/* Boutons de lecture selon le match (Plex / IPTV VOD). Le streaming reste informatif. */}
              {!loadingMatch && match && (() => {
                // Meilleur flux IPTV VOD : préf langue du profil sinon le 1er. Pas les séries (épisode requis).
                const vods = (match.iptv ?? []).filter(h => h.kind === 'vod')
                const pref = (currentUser?.preferred_lang ?? '').toLowerCase()
                const iptvHit = vods.length ? (vods.find(h => (h.language ?? '').toLowerCase() === pref) ?? vods[0]) : null
                const hasPlay = !!match.plex?.ratingKey || !!iptvHit
                if (!hasPlay) return null
                return (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {match.plex?.ratingKey && (
                      <button
                        onClick={() => playPlex(match.plex!.ratingKey!)}
                        disabled={playing || !deviceId}
                        title={deviceId ? undefined : 'Choisis un device'}
                        className="flex items-center gap-1.5 text-sm bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40 px-3 py-1.5 rounded transition-colors"
                      >
                        {playing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />} Lire sur Plex
                      </button>
                    )}
                    {iptvHit && (
                      <button
                        onClick={() => playIptv(iptvHit)}
                        disabled={playing || !deviceId}
                        title={deviceId ? undefined : 'Choisis un device'}
                        className="flex items-center gap-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 px-3 py-1.5 rounded transition-colors"
                      >
                        {playing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />} Lire (IPTV){iptvHit.language ? ` ${iptvHit.language}` : ''}
                      </button>
                    )}
                  </div>
                )
              })()}
              {playMsg && <div className="mt-2 text-xs text-zinc-300">{playMsg}</div>}
            </div>

            {/* Actions finales */}
            <div className="mt-6 pt-4 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
              <div className="relative">
                <button
                  onClick={() => setPlaylistOpen(v => !v)}
                  disabled={deciding !== null || !playlistItem}
                  className="flex items-center gap-1.5 text-sm bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40 px-3 py-1.5 rounded transition-colors"
                >
                  <ListVideo size={14} /> Ajouter à la playlist
                </button>
                {playlistOpen && playlistItem && (
                  <PlaylistPicker
                    item={playlistItem}
                    onClose={() => setPlaylistOpen(false)}
                    onAdded={() => { setPlaylistOpen(false); if (isInbox) decide('validated') }}
                  />
                )}
              </div>
              {/* Rescan : item d'inbox réel uniquement (re-tente la résolution). */}
              {isInbox && (
                <button
                  onClick={rescan}
                  disabled={rescanning || deciding !== null}
                  className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 px-3 py-1.5 rounded transition-colors"
                >
                  {rescanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rescanner
                </button>
              )}
              {isInbox && (
                <button
                  onClick={() => decide('wishlist')}
                  disabled={deciding !== null}
                  className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 px-3 py-1.5 rounded transition-colors"
                >
                  {deciding === 'wishlist' ? <Loader2 size={13} className="animate-spin" /> : <Heart size={13} />} Wishlist
                </button>
              )}
              {isInbox && (
                <button
                  onClick={() => decide('ignored')}
                  disabled={deciding !== null}
                  className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-40 px-3 py-1.5 transition-colors ml-auto"
                >
                  {deciding === 'ignored' ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />} Ignorer
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function AvailabilityBadge({ match }: { match: CompanionMatch }) {
  if (match.status === 'in_catalogue') {
    const sources = match.sources?.length ? match.sources.join(' / ') : 'Catalogue'
    return (
      <span className="inline-flex items-center gap-1.5 text-sm rounded px-3 py-1.5 bg-emerald-600 text-white font-medium">
        <CheckCircle2 size={14} /> Dispo : {sources}
      </span>
    )
  }
  if (match.status === 'streaming_only') {
    const names = (match.platforms ?? []).map(p => p.label ?? platformLabel(p.platform))
    return (
      <span className="inline-flex items-center gap-1.5 text-sm rounded px-3 py-1.5 bg-sky-600 text-white font-medium">
        <Play size={13} fill="currentColor" /> Sur {names.length ? names.join(', ') : 'streaming'}
      </span>
    )
  }
  // not_found
  return (
    <span className="inline-flex items-center gap-1.5 text-sm rounded px-3 py-1.5 bg-zinc-700 text-zinc-200 font-medium">
      <AlertCircle size={14} /> Hors catalogue : à mettre en wishlist
    </span>
  )
}

// Recherche manuelle d'un titre : résout à la main un partage non identifié.
// L'utilisateur tape le titre vu dans la vidéo ; cliquer un résultat l'ajoute comme candidat.
function ManualSearch({ onPick }: { onPick: (c: CompanionCandidate) => void }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<CompanionCandidate[] | null>(null)

  const run = async () => {
    const query = q.trim()
    if (!query || loading) return
    setLoading(true)
    setResults(null)
    try { setResults(await api.companion.search(query)) }
    catch { setResults([]) }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run() }}
          placeholder="Rechercher un titre manuellement…"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500/60"
        />
        <button
          onClick={run}
          disabled={!q.trim() || loading}
          className="flex items-center justify-center bg-amber-500 text-black rounded px-3 py-1.5 hover:bg-amber-400 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </button>
      </div>

      {results && results.length > 0 && (
        <div className="mt-2 space-y-0.5 max-h-56 overflow-y-auto">
          {results.map((c, i) => (
            <button
              key={i}
              onClick={() => onPick(c)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left transition-colors"
            >
              {c.type === 'series' ? <Tv size={13} className="text-zinc-500 shrink-0" /> : <Film size={13} className="text-zinc-500 shrink-0" />}
              <span className="flex-1 min-w-0 text-sm truncate">{c.title ?? 'Sans titre'}{c.year ? ` (${c.year})` : ''}</span>
              <span className="text-[10px] text-zinc-500 uppercase shrink-0">{c.type === 'series' ? 'Série' : 'Film'}</span>
            </button>
          ))}
        </div>
      )}
      {results && results.length === 0 && !loading && (
        <div className="mt-2 text-xs text-zinc-600 px-1">Aucun résultat pour cette recherche.</div>
      )}
    </div>
  )
}

// Sélecteur de playlist en popover (réutilise l'API playlists existante).
function PlaylistPicker({ item, onClose, onAdded }: { item: PlaylistItemInput; onClose: () => void; onAdded: () => void }) {
  const { currentUser, adminUnlocked } = useUser()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api.playlists.list()
      .then(ls => setPlaylists(ls.filter(p => adminUnlocked || p.owner_user_id === currentUser?.id)))
      .catch(() => setPlaylists([]))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addTo = async (pl: Playlist) => {
    setBusyId(pl.id)
    try { await api.playlists.addItem(pl.id, item); onAdded() }
    catch { setBusyId(null) }
  }
  const createAndAdd = async () => {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const r = await api.playlists.create({ name: newName.trim() })
      await api.playlists.addItem(r.id, item)
      onAdded()
    } catch { setCreating(false) }
  }

  return (
    <div className="absolute z-10 bottom-full mb-2 left-0 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Playlist</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={13} /></button>
      </div>
      {loading ? (
        <div className="py-4 flex justify-center text-zinc-500"><Loader2 size={16} className="animate-spin" /></div>
      ) : (
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {playlists.map(pl => (
            <button key={pl.id} onClick={() => addTo(pl)} disabled={busyId === pl.id} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left transition-colors">
              <ListVideo size={13} className="text-zinc-500 shrink-0" />
              <span className="flex-1 min-w-0 text-sm truncate">{pl.name}</span>
              {busyId === pl.id && <Loader2 size={13} className="animate-spin text-amber-400" />}
            </button>
          ))}
          {playlists.length === 0 && <div className="text-xs text-zinc-600 px-2 py-1.5">Aucune playlist modifiable.</div>}
        </div>
      )}
      <div className="border-t border-zinc-800 mt-2 pt-2 flex items-center gap-1.5">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') createAndAdd() }}
          placeholder="Nouvelle playlist…"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-amber-500/60"
        />
        <button onClick={createAndAdd} disabled={!newName.trim() || creating} className="flex items-center bg-amber-500 text-black rounded px-2 py-1 hover:bg-amber-400 disabled:opacity-50">
          {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        </button>
      </div>
    </div>
  )
}
