import { useMemo, useState } from 'react'
import { api, PlaylistItem, PlaylistItemInput, ScrapedListItem } from '../api'
import { loadResolveContext, makeResolveCache, resolveScrapedItem } from '../lib/resolve'
import { X, Loader2, Braces, RotateCcw, AlertTriangle } from 'lucide-react'

const LANGS = ['FR', 'EN', 'DE', 'ES', 'IT', 'MULTI']

// Entrée JSON normalisée (le champ id sert à préserver un item déjà résolu).
type Entry = { id?: number; title: string; year: number | null; type: 'movie' | 'series' }

function toEntry(e: any): Entry | null {
  if (typeof e === 'string') {
    let s = e.trim(); if (!s) return null
    let type: 'movie' | 'series' = 'movie'
    const pref = s.match(/^(s[ée]rie|tv|show)\s*[:\-]\s*(.+)$/i)
    if (pref) { type = 'series'; s = pref[2].trim() }
    let year: number | null = null
    const ym = s.match(/^(.*?)[\s.\-]*\((\d{4})\)\s*$/)
    if (ym) { s = ym[1].trim(); year = Number(ym[2]) }
    return { title: s, year, type }
  }
  if (e && typeof e === 'object') {
    const title = String(e.title ?? e.name ?? '').trim()
    if (!title) return null
    const t = String(e.type ?? e.kind ?? '').toLowerCase()
    const type: 'movie' | 'series' = (t === 'series' || t === 'serie' || t === 'tv' || t === 'show') ? 'series' : 'movie'
    const year = Number.isFinite(Number(e.year)) && Number(e.year) > 0 ? Number(e.year) : null
    const id = Number.isFinite(Number(e.id)) ? Number(e.id) : undefined
    return { id, title, year, type }
  }
  return null
}

// Sérialise les items actuels en JSON lisible (id conservé pour la préservation).
function itemsToJson(items: PlaylistItem[]): string {
  return JSON.stringify(items.map(it => ({
    id: it.id,
    title: it.title ?? '',
    ...(it.year ? { year: it.year } : {}),
    type: (it.ref_type === 'series' || it.ref_type === 'show' || it.ref_type === 'episode') ? 'series' : 'movie',
  })), null, 2)
}

// Édition de la playlist en JSON. Par défaut, les lignes avec un `id` gardent leur
// résolution (version Plex/IPTV) intacte ; une ligne sans id est un nouveau titre
// qui sera résolu. La case « re-résoudre tout » force un nouveau matching complet.
export default function PlaylistJsonModal({ playlistId, items, defaultLang, onClose, onDone }: {
  playlistId: number; items: PlaylistItem[]; defaultLang: string
  onClose: () => void; onDone: () => void
}) {
  const initial = useMemo(() => itemsToJson(items), [items])
  const [text, setText] = useState(initial)
  const [reResolveAll, setReResolveAll] = useState(false)
  const [lang, setLang] = useState(defaultLang)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; matched: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = async () => {
    setError(null)
    let parsed: any
    try { parsed = JSON.parse(text) } catch { setError('JSON invalide — vérifie les virgules et les guillemets.'); return }
    const arr: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed.list) ? parsed.list : []
    const entries = arr.map(toEntry).filter(Boolean) as Entry[]
    if (!entries.length) { setError('Aucune entrée exploitable (au moins un title est requis).'); return }

    const existingById = new Map(items.map(it => [it.id, it]))
    const needResolve = (en: Entry) => reResolveAll || en.id == null || !existingById.has(en.id)
    const total = entries.filter(needResolve).length

    setSaving(true)
    setProgress(total > 0 ? { done: 0, total, matched: 0 } : null)
    try {
      const ctx = total > 0 ? await loadResolveContext() : { sections: [], credId: null }
      const cache = makeResolveCache()
      const final: PlaylistItemInput[] = []
      let done = 0, matched = 0
      for (const en of entries) {
        if (!needResolve(en) && en.id != null) {
          const it = existingById.get(en.id)!
          final.push({
            app: it.app,
            ref_id: it.ref_id ?? undefined,
            ref_type: it.ref_type ?? undefined,
            title: en.title || it.title || undefined,
            year: en.year ?? it.year ?? undefined,
            thumb: it.thumb ?? undefined,
            lang: it.lang ?? undefined,
            ext: it.ext ?? undefined,
            status: it.status === 'missing' ? 'missing' : 'resolved',
          })
        } else {
          const scraped: ScrapedListItem = { position: final.length + 1, title: en.title, year: en.year, type: en.type, kind: en.type === 'series' ? 'show' : 'movie' }
          const r = await resolveScrapedItem(scraped, ctx.sections, ctx.credId, cache, lang)
          if (r.status === 'resolved') matched++
          final.push(r)
          done++; setProgress({ done, total, matched })
        }
      }
      await api.playlists.replaceItems(playlistId, final)
      onDone(); onClose()
    } catch (e: any) {
      setError(e.message || 'Échec de l\'enregistrement')
      setSaving(false); setProgress(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-2xl mt-10 mb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h3 className="font-semibold flex items-center gap-2"><Braces size={16} className="text-amber-400" /> Éditer en JSON</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Réordonne, ajoute ou retire des lignes. Une ligne avec <code className="text-zinc-300">id</code> garde sa version actuelle (Plex/IPTV).
            Une ligne <span className="text-zinc-300">sans id</span> est un nouveau titre qui sera résolu. Les lignes retirées sont supprimées.
          </p>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={14}
            spellCheck={false}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:border-amber-500/60 resize-y"
          />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-200">
                <input type="checkbox" className="accent-amber-500" checked={reResolveAll} onChange={e => setReResolveAll(e.target.checked)} />
                Re-résoudre tout
              </label>
              <button onClick={() => setText(initial)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                <RotateCcw size={12} /> Remettre la liste actuelle
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              Langue (IPTV)
              <select value={lang} onChange={e => setLang(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/60">
                {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>

          {reResolveAll && (
            <div className="text-[11px] text-amber-400/90 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Tout sera re-matché contre Plex/IPTV : les choix de version faits à la main seront écrasés.
            </div>
          )}

          {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded p-2.5">{error}</div>}

          {progress ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="flex items-center gap-2"><Loader2 size={15} className="animate-spin text-amber-400" /> Résolution…</span>
                <span className="text-zinc-400">{progress.done}/{progress.total} · <span className="text-green-400">{progress.matched} trouvés</span></span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="text-sm text-zinc-400 hover:text-zinc-200 px-4 py-2">Annuler</button>
              <button onClick={apply} disabled={saving}
                className="flex items-center gap-2 bg-amber-500 text-black font-medium rounded-lg px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : null} Appliquer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
