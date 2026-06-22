import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ScrapedList, ScrapedListItem, ScListResult } from '../api'
import { loadResolveContext, makeResolveCache, resolveScrapedItem } from '../lib/resolve'
import { useUser } from '../UserContext'
import { ArrowLeft, Download, Loader2, Link2, Heart, Film, Tv, Check, AlertTriangle, Search, ClipboardList } from 'lucide-react'

const LANGS = ['FR', 'EN', 'DE', 'ES', 'IT', 'MULTI']
type Provider = 'senscritique' | 'trakt' | 'paste'
const PROVIDERS: { id: Provider; label: string; placeholder: string; urlPlaceholder: string }[] = [
  { id: 'senscritique', label: 'SensCritique', placeholder: 'Rechercher une liste (ex. chronologie MCU, James Bond…)', urlPlaceholder: 'https://www.senscritique.com/liste/…' },
  { id: 'trakt', label: 'Trakt', placeholder: 'Rechercher une liste (ex. MCU chronological, Alien…)', urlPlaceholder: 'https://trakt.tv/users/<user>/lists/<slug>' },
  { id: 'paste', label: 'Texte / JSON', placeholder: '', urlPlaceholder: '' },
]

// ── Parsing d'une liste collée (texte libre ou JSON) ─────────────────────────
// Texte : une ligne = un titre, format « Titre (Année) ». Préfixe « série: »/« tv: »
// pour forcer une série. Lignes vides ou commençant par # ignorées.
function parseTextLine(line: string, i: number): ScrapedListItem {
  let s = line.trim()
  let type: 'movie' | 'series' = 'movie'
  const pref = s.match(/^(s[ée]rie|tv|show)\s*[:\-]\s*(.+)$/i)
  if (pref) { type = 'series'; s = pref[2].trim() }
  let year: number | null = null
  const ym = s.match(/^(.*?)[\s.\-]*\((\d{4})\)\s*$/)
  if (ym) { s = ym[1].trim(); year = Number(ym[2]) }
  return { position: i + 1, title: s, year, type, kind: type === 'series' ? 'show' : 'movie' }
}
function parseJsonEntry(e: any, i: number): ScrapedListItem | null {
  if (typeof e === 'string') return parseTextLine(e, i)
  if (e && typeof e === 'object') {
    const title = String(e.title ?? e.name ?? '').trim()
    if (!title) return null
    const t = String(e.type ?? e.kind ?? '').toLowerCase()
    const type: 'movie' | 'series' = (t === 'series' || t === 'serie' || t === 'tv' || t === 'show') ? 'series' : 'movie'
    const year = Number.isFinite(Number(e.year)) && Number(e.year) > 0 ? Number(e.year) : null
    return { position: typeof e.position === 'number' ? e.position : i + 1, title, year, type, kind: type === 'series' ? 'show' : 'movie', original_title: e.original_title ?? null }
  }
  return null
}
function parsePastedList(raw: string): ScrapedListItem[] {
  const text = raw.trim()
  if (!text) return []
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const json = JSON.parse(text)
      const arr: any[] = Array.isArray(json) ? json : Array.isArray(json.items) ? json.items : Array.isArray(json.list) ? json.list : []
      const out = arr.map((e, i) => parseJsonEntry(e, i)).filter(Boolean) as ScrapedListItem[]
      if (out.length) return out
    } catch { /* JSON invalide → on retombe en mode texte ligne par ligne */ }
  }
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(parseTextLine)
}

export default function ImportPlaylist() {
  const navigate = useNavigate()
  const { currentUser } = useUser()
  const [provider, setProvider] = useState<Provider>('senscritique')
  const [mode, setMode] = useState<'search' | 'url'>('search')
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<ScListResult[]>([])
  const [url, setUrl] = useState('')
  const [pasteText, setPasteText] = useState('')
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
      const r = await api[provider as 'senscritique' | 'trakt'].scrape(target)
      setScraped(r); setName(r.title)
    } catch (e: any) {
      setError(e.message || 'Échec du chargement')
    } finally { setLoading(false) }
  }

  const runSearch = async () => {
    if (q.trim().length < 2 || searching) return
    setSearching(true); setError(null)
    try {
      setResults(await api[provider as 'senscritique' | 'trakt'].search(q.trim()))
    } catch (e: any) {
      setError(e.message || 'Recherche indisponible')
    } finally { setSearching(false) }
  }

  // Analyse le texte/JSON collé en une liste locale (sans appel réseau) ; le reste
  // du flux (résolution Plex/IPTV, création) est identique aux autres fournisseurs.
  const analysePaste = () => {
    setError(null)
    const items = parsePastedList(pasteText)
    if (!items.length) { setError('Aucun titre détecté. Mets un titre par ligne, ou colle un tableau JSON.'); return }
    const title = name.trim() || 'Ma liste'
    setScraped({ title, cover: null, description: null, likes: 0, total: items.length, source_url: '', items })
    if (!name.trim()) setName(title)
  }

  // Change de fournisseur : on repart d'une page vierge.
  const switchProvider = (p: Provider) => {
    if (p === provider) return
    setProvider(p); setResults([]); setScraped(null); setError(null); setUrl(''); setQ(''); setPasteText('')
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
        source: provider,
        source_url: scraped.source_url,
      })
      const { sections, credId } = await loadResolveContext()
      const cache = makeResolveCache()

      let matched = 0
      for (let i = 0; i < scraped.items.length; i++) {
        const resolved = await resolveScrapedItem(scraped.items[i], sections, credId, cache, lang)
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
        <h1 className="text-2xl font-bold tracking-tight">Importer une playlist</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {provider === 'trakt'
            ? 'Depuis Trakt (chronologies épisode par épisode, ex. MCU). On résout chaque épisode vers ton Plex.'
            : provider === 'paste'
              ? 'Colle ta propre liste (texte ou JSON). On résout chaque titre vers ton Plex et ton IPTV.'
              : 'Depuis SensCritique (ex. une chronologie MCU). On résout chaque titre vers ton Plex et ton IPTV.'}
        </p>
      </div>

      {/* Fournisseur */}
      <div className="flex gap-2">
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            onClick={() => switchProvider(p.id)}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${provider === p.id ? 'bg-zinc-100 text-black border-zinc-100 font-medium' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-600'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Onglets (recherche/URL pour les fournisseurs en ligne uniquement) */}
      {provider !== 'paste' && (
      <div className="flex bg-zinc-900 border border-zinc-800 rounded overflow-hidden w-fit">
        <button onClick={() => setMode('search')} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${mode === 'search' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <Search size={13} /> Rechercher
        </button>
        <button onClick={() => setMode('url')} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${mode === 'url' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <Link2 size={13} /> Coller une URL
        </button>
      </div>
      )}

      {/* Collage texte / JSON */}
      {provider === 'paste' && !scraped && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={9}
            placeholder={'Un titre par ligne, ex.\nInception (2010)\nLe Parrain (1972)\nsérie: Breaking Bad (2008)\n\n…ou un JSON :\n[{ "title": "Inception", "year": 2010, "type": "movie" }]'}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-amber-500/60 resize-y"
          />
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] text-zinc-600 leading-relaxed">
              <div><span className="text-zinc-400">Texte</span> : un titre par ligne, format « Titre (Année) ». Préfixe « série: » (ou « tv: ») pour forcer une série.</div>
              <div className="mt-0.5">
                <span className="text-zinc-400">JSON</span> : un tableau (ou {`{ "items": [...] }`}). Chaque entrée = une chaîne, ou un objet&nbsp;:
                {' '}<code className="text-zinc-400">title</code> (requis),
                {' '}<code className="text-zinc-400">year</code>,
                {' '}<code className="text-zinc-400">type</code> (<code>movie</code> par défaut, ou <code>series</code>/<code>tv</code>/<code>show</code>) — optionnels.
              </div>
            </div>
            <button onClick={analysePaste} disabled={!pasteText.trim()} className="shrink-0 flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 text-sm rounded px-4 py-1.5 hover:border-zinc-500 disabled:opacity-50">
              <ClipboardList size={14} /> Analyser
            </button>
          </div>
        </div>
      )}

      {provider !== 'paste' && (mode === 'url' ? (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') preview() }}
              placeholder={PROVIDERS.find(p => p.id === provider)!.urlPlaceholder}
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
                placeholder={PROVIDERS.find(p => p.id === provider)!.placeholder}
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
                  <div className="p-2.5">
                    <div className="text-sm font-medium line-clamp-2">{r.title}</div>
                    {r.item_count != null && <div className="text-[11px] text-zinc-500 mt-0.5">{r.item_count} élément{r.item_count > 1 ? 's' : ''}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

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
