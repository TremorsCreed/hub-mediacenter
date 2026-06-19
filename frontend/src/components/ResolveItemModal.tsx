import { useEffect, useState } from 'react'
import { api, PlaylistItem, PlexItem, PlexSection, IptvStream } from '../api'
import { X, Search, Loader2, Film, Radio, Check } from 'lucide-react'

const LANGS = ['FR', 'EN', 'DE', 'ES', 'IT', 'MULTI']

// Modal de résolution / choix de version : cherche dans Plex et IPTV, et ré-lie l'item
// de playlist à la version choisie (films multiples, cut original vs remaster, Plex vs IPTV…).
export default function ResolveItemModal({ playlistId, item, defaultLang, onClose, onDone }: {
  playlistId: number; item: PlaylistItem; defaultLang: string
  onClose: () => void; onDone: () => void
}) {
  const [query, setQuery] = useState(item.title ?? '')
  const [lang, setLang] = useState(defaultLang)
  const [searching, setSearching] = useState(false)
  const [sections, setSections] = useState<PlexSection[]>([])
  const [credId, setCredId] = useState<number | null>(null)
  const [plexResults, setPlexResults] = useState<PlexItem[]>([])
  const [iptvResults, setIptvResults] = useState<IptvStream[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      api.plex.sections().catch(() => [] as PlexSection[]),
      api.iptv.credentials().catch(() => [] as { id: number; name: string }[]),
    ]).then(([secs, creds]) => {
      setSections(secs)
      setCredId(creds[0]?.id ?? null)
    })
  }, [])

  const runSearch = async () => {
    const q = query.trim()
    if (!q || searching) return
    setSearching(true)
    try {
      const plex: PlexItem[] = []
      for (const sec of sections.filter(s => s.type === 'movie' || s.type === 'show')) {
        const r = await api.plex.sectionItems(sec.id, { size: 8, search: q }).catch(() => ({ items: [] as PlexItem[] } as any))
        plex.push(...r.items)
      }
      const seen = new Set<string>()
      setPlexResults(plex.filter(p => (seen.has(p.ratingKey) ? false : (seen.add(p.ratingKey), true))))

      const iptv: IptvStream[] = []
      if (credId) {
        for (const t of ['vod', 'series'] as const) {
          const r = await api.iptv.streams(credId, { type: t, search: q, languages: lang ? [lang] : undefined, limit: 8 }).catch(() => ({ items: [] as IptvStream[] } as any))
          iptv.push(...r.items)
        }
      }
      setIptvResults(iptv)
    } finally { setSearching(false) }
  }

  // Lance une 1re recherche dès que les sections sont chargées.
  useEffect(() => { if (sections.length || credId) runSearch() }, [sections, credId])

  const pickPlex = async (c: PlexItem) => {
    setSaving(true)
    await api.playlists.updateItem(playlistId, item.id, {
      app: 'plex', ref_id: c.ratingKey, ref_type: c.type, title: c.title, year: c.year ?? undefined, thumb: c.thumb, status: 'resolved',
    }).catch(() => {})
    onDone(); onClose()
  }
  const pickIptv = async (s: IptvStream) => {
    setSaving(true)
    await api.playlists.updateItem(playlistId, item.id, {
      app: 'iptv', ref_id: s.stream_id, ref_type: s.type, title: item.title ?? s.name,
      year: item.year ?? (s.year ? Number(s.year) : undefined), thumb: s.logo, lang, status: 'resolved',
    }).catch(() => {})
    onDone(); onClose()
  }

  return (
    <div className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-2xl mt-10 mb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="min-w-0">
            <h3 className="font-semibold truncate">Choisir la version</h3>
            <p className="text-xs text-zinc-500 truncate">{item.title}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Recherche */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
                placeholder="Affiner la recherche (titre, année…)"
                className="w-full bg-zinc-900 border border-zinc-800 rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
              />
            </div>
            <select value={lang} onChange={e => setLang(e.target.value)} title="Langue (IPTV)" className="bg-zinc-900 border border-zinc-800 rounded px-2 text-sm focus:outline-none focus:border-amber-500/60">
              {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <button onClick={runSearch} disabled={searching} className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 text-sm rounded px-4 hover:border-zinc-500 disabled:opacity-50">
              {searching ? <Loader2 size={15} className="animate-spin" /> : 'Chercher'}
            </button>
          </div>

          {saving && <div className="text-sm text-amber-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Enregistrement…</div>}

          {/* Résultats Plex */}
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Film size={12} /> Plex</div>
            {plexResults.length === 0 ? (
              <div className="text-xs text-zinc-600">{searching ? 'Recherche…' : 'Aucun résultat Plex.'}</div>
            ) : (
              <div className="space-y-1.5">
                {plexResults.map(c => {
                  const current = item.app === 'plex' && item.ref_id === c.ratingKey
                  return (
                    <button key={c.ratingKey} onClick={() => pickPlex(c)} disabled={saving}
                      className={`w-full flex items-center gap-3 text-left bg-zinc-900 border rounded-lg p-2 hover:border-amber-500/60 transition-colors disabled:opacity-50 ${current ? 'border-green-600/60' : 'border-zinc-800'}`}>
                      <div className="w-9 h-12 rounded bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {c.thumb ? <img src={api.plex.imageUrl(c.thumb)} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} /> : <Film size={14} className="text-zinc-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{c.title}</div>
                        <div className="text-xs text-zinc-500">{c.type === 'show' ? 'série' : 'film'}{c.year ? ` · ${c.year}` : ''}</div>
                      </div>
                      {current && <span className="text-[10px] text-green-400 flex items-center gap-1"><Check size={11} /> actuel</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Résultats IPTV */}
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Radio size={12} /> IPTV</div>
            {iptvResults.length === 0 ? (
              <div className="text-xs text-zinc-600">{searching ? 'Recherche…' : 'Aucun résultat IPTV.'}</div>
            ) : (
              <div className="space-y-1.5">
                {iptvResults.map(s => {
                  const current = item.app === 'iptv' && item.ref_id === s.stream_id
                  return (
                    <button key={`${s.type}-${s.stream_id}`} onClick={() => pickIptv(s)} disabled={saving}
                      className={`w-full flex items-center gap-3 text-left bg-zinc-900 border rounded-lg p-2 hover:border-amber-500/60 transition-colors disabled:opacity-50 ${current ? 'border-green-600/60' : 'border-zinc-800'}`}>
                      <div className="w-9 h-12 rounded bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {s.logo ? <img src={api.iptv.imageUrl(s.logo)} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} /> : <Radio size={14} className="text-zinc-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{s.name}</div>
                        <div className="text-xs text-zinc-500">{s.type === 'series' ? 'série' : 'film'}{s.year ? ` · ${s.year}` : ''}{s.language ? ` · ${s.language}` : ''}</div>
                      </div>
                      {current && <span className="text-[10px] text-green-400 flex items-center gap-1"><Check size={11} /> actuel</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
