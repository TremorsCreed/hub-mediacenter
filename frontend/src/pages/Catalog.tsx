import { useEffect, useState } from 'react'
import { api, CatalogEntry } from '../api'
import { Search, Trash2, Plus } from 'lucide-react'

const MEDIA_TYPES = ['movie', 'episode', 'music', 'live_channel', 'vod'] as const

export default function Catalog() {
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [q, setQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ title: '', type: 'movie', ean: '', year: '', plex_id: '', tivimate_id: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => setEntries(await api.catalog.search(q))

  useEffect(() => { load() }, [q])

  const remove = async (id: string) => {
    if (!confirm('Remove from catalog?')) return
    await api.catalog.remove(id)
    load()
  }

  const save = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await api.catalog.create({
        title: form.title,
        type: form.type as any,
        ean: form.ean || undefined,
        year: form.year ? parseInt(form.year) : undefined,
        plex_id: form.plex_id || undefined,
        tivimate_id: form.tivimate_id || undefined
      })
      setForm({ title: '', type: 'movie', ean: '', year: '', plex_id: '', tivimate_id: '' })
      setShowAdd(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Catalog</h1>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded transition-colors"
        >
          <Plus size={13} /> Add entry
        </button>
      </div>

      {showAdd && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Title *</label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="The Fellowship of the Ring"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Type</label>
              <select
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none"
                value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              >
                {MEDIA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">EAN / Barcode</label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                value={form.ean} onChange={e => setForm(f => ({ ...f, ean: e.target.value }))}
                placeholder="3307216248552"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Year</label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                placeholder="2001"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Plex ID</label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                value={form.plex_id} onChange={e => setForm(f => ({ ...f, plex_id: e.target.value }))}
                placeholder="12345"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">TiviMate channel ID</label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                value={form.tivimate_id} onChange={e => setForm(f => ({ ...f, tivimate_id: e.target.value }))}
                placeholder="channel_id"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="text-sm text-zinc-500 hover:text-zinc-300 px-3 py-1.5">Cancel</button>
            <button
              onClick={save} disabled={saving || !form.title.trim()}
              className="text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-1.5 rounded transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 pl-8 text-sm focus:outline-none focus:border-zinc-600"
          placeholder="Search catalog..."
          value={q} onChange={e => setQ(e.target.value)}
        />
      </div>

      {entries.length === 0 && (
        <div className="text-sm text-zinc-600 py-8 text-center">Catalog is empty.</div>
      )}

      <div className="space-y-2">
        {entries.map(e => (
          <div key={e.id} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
            <div>
              <div className="text-sm font-medium">{e.title} {e.year && <span className="text-zinc-500 font-normal">({e.year})</span>}</div>
              <div className="text-xs text-zinc-600 mt-0.5 flex gap-3">
                <span>{e.type}</span>
                {e.ean && <span>EAN: {e.ean}</span>}
                {e.plex_id && <span>Plex: {e.plex_id}</span>}
                {e.tivimate_id && <span>TiviMate: {e.tivimate_id}</span>}
              </div>
            </div>
            <button onClick={() => remove(e.id)} className="text-zinc-600 hover:text-red-400 transition-colors p-1">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
