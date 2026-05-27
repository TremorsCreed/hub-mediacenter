import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, Device, DiscoverAvailability, DiscoverItem } from '../api'
import { Search, Loader2, AlertCircle, Play, X, Languages } from 'lucide-react'
import IptvSeriesModal from '../components/IptvSeriesModal'

const LANG_PREFS_KEY = 'iptv.languages.selected'  // partagé avec la page IPTV
const COMMON_LANG_LABELS: Record<string, string> = {
  FR: 'Français', EN: 'English', DE: 'Deutsch', ES: 'Español', IT: 'Italiano',
  NL: 'Nederlands', PT: 'Português', RU: 'Русский', TR: 'Türkçe', AR: 'العربية',
  PL: 'Polski', GR: 'Ελληνικά', RO: 'Română', HU: 'Magyar', CZ: 'Čeština',
  JP: '日本語', KO: '한국어', CN: '中文', MULTI: 'Multi',
}

// Couleurs et libellés par plateforme
const PLATFORM_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  netflix:        { label: 'Netflix',        bg: '#e50914', fg: '#fff' },
  'disney+':      { label: 'Disney+',        bg: '#0e1b3a', fg: '#fff' },
  disneyplus:     { label: 'Disney+',        bg: '#0e1b3a', fg: '#fff' },
  primevideo:     { label: 'Prime Video',    bg: '#00a8e1', fg: '#000' },
  amazon:         { label: 'Prime Video',    bg: '#00a8e1', fg: '#000' },
  appletvplus:    { label: 'Apple TV+',      bg: '#000000', fg: '#fff' },
  apple:          { label: 'Apple TV+',      bg: '#000000', fg: '#fff' },
  youtube:        { label: 'YouTube',        bg: '#ff0000', fg: '#fff' },
  max:            { label: 'Max',            bg: '#002be7', fg: '#fff' },
  hbo:            { label: 'HBO',            bg: '#1a1a1a', fg: '#fff' },
  'paramount+':   { label: 'Paramount+',     bg: '#0064ff', fg: '#fff' },
  paramountplus:  { label: 'Paramount+',     bg: '#0064ff', fg: '#fff' },
  iptv:           { label: 'IPTV (VOD)',     bg: '#f59e0b', fg: '#0d0d14' },
}

function platformStyle(p: string) {
  return PLATFORM_STYLE[p.toLowerCase()] ?? { label: p, bg: '#3f3f46', fg: '#fff' }
}

export default function Discover() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [results, setResults] = useState<DiscoverItem[]>([])
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [selected, setSelected] = useState<DiscoverItem | null>(null)
  const [availabilities, setAvailabilities] = useState<DiscoverAvailability[] | null>(null)
  const [loadingAv, setLoadingAv] = useState(false)
  const [launching, setLaunching] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [iptvSeriesOpen, setIptvSeriesOpen] = useState<{ credId: number; seriesId: string; title: string; cover?: string } | null>(null)
  const [selectedLangs, setSelectedLangs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(LANG_PREFS_KEY) ?? '["FR","EN"]') } catch { return ['FR', 'EN'] }
  })
  const [langPanelOpen, setLangPanelOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(LANG_PREFS_KEY, JSON.stringify(selectedLangs))
  }, [selectedLangs])

  const toggleLang = (code: string) =>
    setSelectedLangs(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])

  // Filtre : on garde toutes les availabilities sauf IPTV qui ne match pas la langue.
  // Les IPTV sans langue détectée sont toujours gardés.
  const visibleAvailabilities = useMemo(() => {
    if (!availabilities) return null
    if (selectedLangs.length === 0) return availabilities  // pas de filtre actif
    return availabilities.filter(av => {
      if (av.platform !== 'iptv') return true       // Netflix/Plex/Disney+/etc. toujours visibles
      if (!av.iptv_language) return true            // IPTV sans tag langue → on garde
      return selectedLangs.includes(av.iptv_language)
    })
  }, [availabilities, selectedLangs])

  // Liste des langues IPTV disponibles dans le set actuel (pour le popover)
  const availableIptvLangs = useMemo(() => {
    const set = new Set<string>()
    for (const av of availabilities ?? []) if (av.iptv_language) set.add(av.iptv_language)
    // Toujours proposer FR/EN même si pas dans le résultat courant
    set.add('FR'); set.add('EN')
    return [...set].sort()
  }, [availabilities])

  useEffect(() => {
    api.devices.list().then(ds => {
      setDevices(ds)
      const cd = ds.find(d => d.ws_connected)
      if (cd) setDeviceId(cd.id)
    })
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!debouncedSearch) { setResults([]); return }
    setLoading(true)
    api.plex.discoverSearch(debouncedSearch)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [debouncedSearch])

  const openItem = (item: DiscoverItem) => {
    setSelected(item)
    setAvailabilities(null)
    setLoadingAv(true)
    const key = item.ratingKey || item.guid.split('/').pop() || ''
    api.plex.discoverAvailabilities(key, item.title, item.year)
      .then(setAvailabilities)
      .catch(() => setAvailabilities([]))
      .finally(() => setLoadingAv(false))
  }

  const playOn = async (av: DiscoverAvailability) => {
    if (!deviceId) { setToast({ msg: 'Sélectionne un device', ok: false }); return }
    if (!selected) return

    // Cas spécial : IPTV série → on ouvre la modale série pour choisir l'épisode
    if (av.platform === 'iptv' && av.iptv_kind === 'series' && av.iptv_credential_id && av.iptv_stream_id) {
      setIptvSeriesOpen({
        credId: av.iptv_credential_id,
        seriesId: av.iptv_stream_id,
        title: selected.title,
        cover: selected.thumb,
      })
      setSelected(null)
      return
    }

    setLaunching(`${av.platform}-${av.iptv_language ?? ''}`)
    try {
      // IPTV VOD ou autre plateforme externe
      const intent = av.platform === 'iptv' && av.iptv_stream_id
        ? { iptv_stream_id: av.iptv_stream_id, iptv_type: 'vod' as const, app: 'iptv' }
        : { external_url: av.url, external_platform: av.platform }
      const r = await api.play({
        ...intent,
        title: selected.title,
        thumb: selected.thumb,
        device_id: deviceId,
        requester: 'manual',
      })
      setToast({ msg: `▶ ${r.title} sur ${platformStyle(av.platform).label}`, ok: true })
      setSelected(null)
    } catch (e: any) {
      setToast({ msg: `Échec : ${e.message}`, ok: false })
    } finally {
      setLaunching(null)
      setTimeout(() => setToast(null), 4000)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold mr-auto">Discover</h1>

        <div className="relative">
          <button
            onClick={() => setLangPanelOpen(v => !v)}
            className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600"
            title="Filtrer les sources IPTV par langue (les autres plateformes restent visibles)"
          >
            <Languages size={13} />
            {selectedLangs.length === 0
              ? 'Toutes IPTV'
              : selectedLangs.length <= 3
                ? `IPTV : ${selectedLangs.join(' · ')}`
                : `IPTV : ${selectedLangs.length} langues`}
          </button>
          {langPanelOpen && (
            <div className="absolute z-20 top-full mt-1 right-0 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2">
              <div className="flex items-center justify-between px-2 py-1 mb-1">
                <span className="text-xs text-zinc-500 uppercase tracking-widest">Langues IPTV</span>
                <button onClick={() => setSelectedLangs([])} className="text-xs text-zinc-500 hover:text-amber-400">Tout</button>
              </div>
              <div className="text-[11px] text-zinc-600 px-2 mb-2">
                Filtre les boutons IPTV (FR, EN…). Plex / Netflix / Disney+ / Prime restent toujours visibles.
              </div>
              {availableIptvLangs.map(code => {
                const checked = selectedLangs.includes(code)
                const label = COMMON_LANG_LABELS[code] ?? code
                return (
                  <label key={code} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-amber-500"
                      checked={checked}
                      onChange={() => toggleLang(code)}
                    />
                    <span className="text-sm text-zinc-200">{label}</span>
                    <span className="text-xs text-zinc-600 ml-auto">{code}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <select
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
        >
          <option value="">— device —</option>
          {devices.map(d => (
            <option key={d.id} value={d.id} disabled={!d.ws_connected}>
              {d.name} {d.ws_connected ? '' : '(offline)'}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-zinc-500">
        Recherche universelle Plex — agrège films / séries sur Netflix, Disney+, Prime Video, Apple TV+...
        Sélectionne un titre pour voir où il est disponible et lancer sur ton device.
      </p>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          autoFocus
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 pl-8 text-sm focus:outline-none focus:border-zinc-600"
          placeholder="Rechercher un film ou une série (Netflix, Disney+, ...)…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-zinc-600 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Recherche en cours…
        </div>
      )}

      {!loading && debouncedSearch && results.length === 0 && (
        <div className="text-sm text-zinc-600 py-12 text-center">Aucun résultat.</div>
      )}

      {!loading && !debouncedSearch && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
          <AlertCircle size={28} />
          <div className="text-sm">Tape un titre pour explorer Netflix / Disney+ / Prime…</div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {results.map(item => (
          <button
            key={item.guid}
            onClick={() => openItem(item)}
            className="group relative aspect-[2/3] bg-zinc-900 border border-zinc-800 rounded overflow-hidden hover:border-amber-500/60 transition-colors text-left"
          >
            {item.thumb ? (
              <img
                src={api.plex.discoverImageUrl(item.thumb)}
                alt={item.title}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs p-2 text-center">{item.title}</div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
              <div className="text-xs font-medium line-clamp-2">{item.title}</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">
                {item.year ? `${item.year} · ` : ''}{item.type === 'show' ? 'Série' : item.type === 'movie' ? 'Film' : item.type}
              </div>
            </div>
            <div className="absolute top-1.5 left-1.5 bg-black/70 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-zinc-300">
              {item.type === 'show' ? 'Série' : 'Film'}
            </div>
          </button>
        ))}
      </div>

      {/* Modale détail / availabilities */}
      {selected && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-zinc-900/95 border border-zinc-700 rounded-lg max-w-2xl w-full p-6 relative shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSelected(null)}
              className="absolute top-3 right-3 text-zinc-500 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>

            <div className="flex gap-4">
              {selected.thumb && (
                <img
                  src={api.plex.discoverImageUrl(selected.thumb)}
                  alt={selected.title}
                  className="w-32 h-48 object-cover rounded shrink-0"
                  onError={e => { e.currentTarget.style.display = 'none' }}
                />
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold leading-tight">{selected.title}</h2>
                <div className="text-xs text-zinc-500 mt-1">
                  {selected.year ? `${selected.year} · ` : ''}{selected.type === 'show' ? 'Série' : 'Film'}
                </div>
                {selected.summary && (
                  <p className="text-sm text-zinc-300 mt-3 line-clamp-6">{selected.summary}</p>
                )}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Disponible sur</div>
              {loadingAv && (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 size={14} className="animate-spin" /> Recherche des plateformes…
                </div>
              )}
              {!loadingAv && visibleAvailabilities && visibleAvailabilities.length === 0 && availabilities && availabilities.length > 0 && (
                <div className="text-sm text-zinc-600">
                  Aucune source ne correspond au filtre langue.
                  <button onClick={() => setSelectedLangs([])} className="ml-2 text-amber-400 hover:underline">Réinitialiser</button>
                </div>
              )}
              {!loadingAv && availabilities && availabilities.length === 0 && (
                <div className="text-sm text-zinc-600">Aucune plateforme dispo pour ce titre.</div>
              )}
              <div className="flex flex-wrap gap-2">
                {visibleAvailabilities?.map(av => {
                  const st = platformStyle(av.platform)
                  // Pour IPTV on a plusieurs entries possibles (FR + EN…) → label unique
                  const label = av.platform === 'iptv'
                    ? `${st.label.replace(' (VOD)', '')} ${av.iptv_kind === 'series' ? 'Série' : 'VOD'}${av.iptv_language ? ` · ${av.iptv_language}` : ''}`
                    : st.label
                  // key unique : pour iptv on a plusieurs urls similaires sans le param ; on combine
                  const key = `${av.platform}-${av.iptv_kind ?? ''}-${av.iptv_language ?? ''}-${av.url}`
                  const busy = launching === `${av.platform}-${av.iptv_language ?? ''}`
                  return (
                    <button
                      key={key}
                      onClick={() => playOn(av)}
                      disabled={launching !== null}
                      className="flex items-center gap-2 px-3 py-2 rounded font-medium text-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                      style={{ background: st.bg, color: st.fg }}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                      {label}
                      {av.offerType && av.offerType !== 'subscription' && (
                        <span className="text-[10px] opacity-80 ml-1">({av.offerType})</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {iptvSeriesOpen && (
        <IptvSeriesModal
          credId={iptvSeriesOpen.credId}
          seriesId={iptvSeriesOpen.seriesId}
          titleFallback={iptvSeriesOpen.title}
          coverFallback={iptvSeriesOpen.cover}
          deviceId={deviceId}
          onClose={() => setIptvSeriesOpen(null)}
          onPlayed={(msg) => { setToast({ msg, ok: true }); setTimeout(() => setToast(null), 4000) }}
          onError={(msg) => { setToast({ msg: `Échec : ${msg}`, ok: false }); setTimeout(() => setToast(null), 4000) }}
        />
      )}

      {toast && createPortal(
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded shadow-lg text-sm font-medium z-[110] ${
          toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>,
        document.body
      )}
    </div>
  )
}
