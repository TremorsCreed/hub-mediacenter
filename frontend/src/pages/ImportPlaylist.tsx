import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ScrapedList, ScrapedListItem, ScListResult, PlexSection, PlaylistItemInput } from '../api'
import { useUser } from '../UserContext'
import { ArrowLeft, Download, Loader2, Link2, Heart, Film, Tv, Check, AlertTriangle, Search } from 'lucide-react'

const LANGS = ['FR', 'EN', 'DE', 'ES', 'IT', 'MULTI']

const norm = (s?: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const titleMatches = (a?: string, b?: string) => {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

export default function ImportPlaylist() {
  const navigate = useNavigate()
  const { currentUser } = useUser()
  const [mode, setMode] = useState<'search' | 'url'>('search')
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<ScListResult[]>([])
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scraped, setScraped] = useState<ScrapedList | null>(null)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [lang, setLang] = useState(currentUser?.preferred_lang ?? 'FR')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; matched: number } | null>(null)

  const preview = async (overrideUrl?: string) => {
    const target = (overrideUrl ?? url).trim()
    if (!target || loading) return
    setLoading(true); setError(null); setScraped(null)
    try {
      const r = await api.senscritique.scrape(target)
      setScraped(r); setName(r.title)
    } catch (e: any) {
      setError(e.message || 'Échec du chargement')
    } finally { setLoading(false) }
  }

  const runSearch = async () => {
    if (q.trim().length < 2 || searching) return
    setSearching(true); setError(null)
    try {
      setResults(await api.senscritique.search(q.trim()))
    } catch (e: any) {
      setError(e.message || 'Recherche indisponible')
    } finally { setSearching(false) }
  }

  // Résout un item SensCritique vers Plex (prioritaire) puis IPTV (langue préférée).
  const resolveItem = async (item: ScrapedListItem, sections: PlexSection[], credId: number | null): Promise<PlaylistItemInput> => {
    const wantShow = item.type === 'series'
    const secs = sections.filter(s => (wantShow ? s.type === 'show' : s.type === 'movie'))
    for (const sec of secs) {
      for (const q of [item.title, item.original_title].filter(Boolean) as string[]) {
        try {
          const r = await api.plex.sectionItems(sec.id, { size: 6, search: q })
          const cands = r.items
          const best =
            cands.find(c => titleMatches(c.title, item.title) && !!item.year && !!c.year && Math.abs((c.year ?? 0) - item.year) <= 1) ||
            cands.find(c => titleMatches(c.title, q))
          if (best) return { app: 'plex', ref_id: best.ratingKey, ref_type: best.type, title: best.title, year: best.year ?? item.year ?? undefined, thumb: best.thumb, status: 'resolved' }
        } catch { /* section search KO, on continue */ }
      }
    }
    if (credId) {
      const type = wantShow ? 'series' : 'vod'
      try {
        const r = await api.iptv.streams(credId, { type, search: item.title, languages: lang ? [lang] : undefined, limit: 8 })
        const best = r.items.find(s => titleMatches(s.name, item.title)) ?? r.items[0]
        if (best) return { app: 'iptv', ref_id: best.stream_id, ref_type: type, title: item.title, year: item.year ?? undefined, thumb: best.logo, lang, status: 'resolved' }
      } catch { /* */ }
    }
    return { app: 'unresolved', ref_type: item.type, title: item.title, year: item.year ?? undefined, status: 'missing' }
  }

  const runImport = async () => {
    if (!scraped || importing) return
    setImporting(true)
    setProgress({ done: 0, total: scraped.items.length, matched: 0 })
    try {
      const created = await api.playlists.create({
        name: name.trim() || scraped.title,
        cover: scraped.cover ?? undefined,
        description: scraped.description ?? undefined,
        is_shared: shared,
        source: 'senscritique',
        source_url: scraped.source_url,
      })
      const [sections, creds] = await Promise.all([
        api.plex.sections().catch(() => [] as PlexSection[]),
        api.iptv.credentials().catch(() => [] as { id: number; name: string }[]),
      ])
      const credId = creds[0]?.id ?? null

      let matched = 0
      for (let i = 0; i < scraped.items.length; i++) {
        const resolved = await resolveItem(scraped.items[i], sections, credId)
        if (resolved.status === 'resolved') matched++
        await api.playlists.addItem(created.id, resolved).catch(() => {})
        setProgress({ done: i + 1, total: scraped.items.length, matched })
      }
      navigate(`/playlists/${created.id}`)
    } catch (e: any) {
      setError(e.message || 'Échec de l\'import')
      setImporting(false)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <button onClick={() => navigate('/playlists')} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
        <ArrowLeft size={13} /> Playlists
      </button>

      <div>
        <h1 className="text-xl font-semibold">Importer une playlist</h1>
        <p className="text-sm text-zinc-500 mt-1">Depuis SensCritique (ex. une chronologie MCU). On résout chaque titre vers ton Plex et ton IPTV.</p>
      </div>

      {/* Onglets */}
      <div className="flex bg-zinc-900 border border-zinc-800 rounded overflow-hidden w-fit">
        <button onClick={() => setMode('search')} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${mode === 'search' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <Search size={13} /> Rechercher
        </button>
        <button onClick={() => setMode('url')} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${mode === 'url' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <Link2 size={13} /> Coller une URL
        </button>
      </div>

      {mode === 'url' ? (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') preview() }}
              placeholder="https://www.senscritique.com/liste/…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
            />
          </div>
          <button onClick={() => preview()} disabled={!url.trim() || loading} className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 text-sm rounded px-4 hover:border-zinc-500 disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : 'Aperçu'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
                placeholder="Rechercher une liste (ex. chronologie MCU, James Bond…)"
                className="w-full bg-zinc-900 border border-zinc-800 rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
              />
            </div>
            <button onClick={runSearch} disabled={q.trim().length < 2 || searching} className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 text-sm rounded px-4 hover:border-zinc-500 disabled:opacity-50">
              {searching ? <Loader2 size={15} className="animate-spin" /> : 'Chercher'}
            </button>
          </div>

          {results.length > 0 && !scraped && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => preview(r.url)}
                  disabled={loading}
                  className="group text-left bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-amber-500/60 transition-colors disabled:opacity-50"
                >
                  <div className="relative aspect-[16/7] bg-zinc-800 overflow-hidden">
                    {r.cover && <img src={r.cover} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />}
                    <span className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-black/65 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] text-red-300">
                      <Heart size={10} fill="currentColor" /> {r.likes}
                    </span>
                  </div>
                  <div className="p-2.5 text-sm font-medium line-clamp-2">{r.title}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded p-3">{error}</div>}

      {/* Aperçu */}
      {scraped && (
        <div className="space-y-4">
          <div className="flex gap-4 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="w-40 aspect-[16/9] rounded bg-zinc-800 overflow-hidden shrink-0">
              {scraped.cover && <img src={scraped.cover} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold leading-tight">{scraped.title}</h2>
              <div className="text-xs text-zinc-500 mt-1 flex items-center gap-3">
                <span className="flex items-center gap-1"><Heart size={11} className="text-red-500" fill="currentColor" /> {scraped.likes}</span>
                <span>{scraped.items.length} élément{scraped.items.length > 1 ? 's' : ''} importable{scraped.items.length > 1 ? 's' : ''}</span>
              </div>
              {scraped.total > scraped.items.length && (
                <div className="text-[11px] text-amber-400 mt-1 flex items-center gap-1">
                  <AlertTriangle size={11} /> SensCritique ne fournit que les {scraped.items.length} premiers sur {scraped.total}.
                </div>
              )}
            </div>
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-zinc-500 uppercase tracking-widest">Nom de la playlist</label>
              <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-widest">Langue (matching IPTV)</label>
              <select value={lang} onChange={e => setLang(e.target.value)} className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60">
                {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <label className="flex items-end gap-2 cursor-pointer pb-2">
              <input type="checkbox" className="accent-amber-500" checked={shared} onChange={e => setShared(e.target.checked)} />
              <span className="text-sm text-zinc-200">Partagée (famille)</span>
            </label>
          </div>

          {/* Liste des items */}
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {scraped.items.map(it => (
              <div key={it.position} className="flex items-center gap-2 text-sm px-3 py-1.5 bg-zinc-900/50 rounded">
                <span className="text-xs text-zinc-600 w-5 text-right">{it.position}</span>
                {it.type === 'series' ? <Tv size={13} className="text-zinc-500" /> : <Film size={13} className="text-zinc-500" />}
                <span className="flex-1 truncate">{it.title}</span>
                {it.year && <span className="text-xs text-zinc-600">{it.year}</span>}
              </div>
            ))}
          </div>

          {/* Import */}
          {progress ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="flex items-center gap-2"><Loader2 size={15} className="animate-spin text-amber-400" /> Résolution…</span>
                <span className="text-zinc-400">{progress.done}/{progress.total} · <span className="text-green-400">{progress.matched} trouvés</span></span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          ) : (
            <button onClick={runImport} disabled={importing} className="w-full flex items-center justify-center gap-2 bg-amber-500 text-black font-medium rounded-lg px-4 py-2.5 hover:bg-amber-400 disabled:opacity-50">
              <Download size={16} /> Importer dans le Hub
            </button>
          )}
        </div>
      )}
    </div>
  )
}
