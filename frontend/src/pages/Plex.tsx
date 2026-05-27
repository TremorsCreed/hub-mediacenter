import { useEffect, useMemo, useState } from 'react'
import { api, Device, PlexItem, PlexSection } from '../api'
import { Search, Play, Loader2, AlertCircle } from 'lucide-react'

const PAGE_SIZE = 60

export default function Plex() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [sections, setSections] = useState<PlexSection[]>([])
  const [sectionId, setSectionId] = useState<string>('')
  const [items, setItems] = useState<PlexItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [launching, setLaunching] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    api.plex.status().then(s => {
      setConnected(s.connected)
      if (s.connected) api.plex.sections().then(setSections)
    })
    api.devices.list().then(ds => {
      setDevices(ds)
      const connectedDev = ds.find(d => d.ws_connected)
      if (connectedDev) setDeviceId(connectedDev.id)
    })
  }, [])

  useEffect(() => {
    if (sections.length && !sectionId) setSectionId(sections[0].id)
  }, [sections])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(0) }, [sectionId, debouncedSearch])

  useEffect(() => {
    if (!sectionId) return
    setLoading(true)
    api.plex.sectionItems(sectionId, {
      start: page * PAGE_SIZE,
      size: PAGE_SIZE,
      search: debouncedSearch || undefined,
    })
      .then(r => { setItems(r.items); setTotal(r.total) })
      .finally(() => setLoading(false))
  }, [sectionId, page, debouncedSearch])

  const play = async (item: PlexItem) => {
    if (!deviceId) {
      setToast({ msg: 'Sélectionne un device', ok: false })
      return
    }
    setLaunching(item.ratingKey)
    try {
      const r = await api.play({
        plex_id: item.ratingKey,
        title: item.title,
        app: 'plex',
        device_id: deviceId,
        requester: 'manual',
      })
      setToast({ msg: `▶ ${r.title}`, ok: true })
    } catch (e: any) {
      setToast({ msg: `Échec : ${e.message}`, ok: false })
    } finally {
      setLaunching(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  if (connected === false) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3">
        <AlertCircle size={32} />
        <div className="text-sm">Plex n'est pas connecté.</div>
        <a href="/settings" className="text-amber-400 hover:text-amber-300 text-sm underline">Aller dans Settings</a>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold mr-auto">Plex</h1>

        <select
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
          value={sectionId}
          onChange={e => setSectionId(e.target.value)}
        >
          {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>

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

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 pl-8 text-sm focus:outline-none focus:border-zinc-600"
          placeholder="Rechercher dans la bibliothèque…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading && items.length === 0 && (
        <div className="flex items-center justify-center py-16 text-zinc-600 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Chargement…
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-zinc-600 py-16 text-center">Aucun résultat.</div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {items.map(item => (
          <button
            key={item.ratingKey}
            onClick={() => play(item)}
            disabled={launching === item.ratingKey}
            className="group relative aspect-[2/3] bg-zinc-900 border border-zinc-800 rounded overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50"
          >
            {item.thumb ? (
              <img
                src={api.plex.imageUrl(item.thumb)}
                alt={item.title}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs p-2 text-center">
                {item.title}
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
              <div className="text-xs font-medium line-clamp-2">{item.title}</div>
              {item.year && <div className="text-[10px] text-zinc-400 mt-0.5">{item.year}</div>}
              <div className="flex items-center gap-1 mt-1.5 text-amber-400 text-xs">
                <Play size={11} fill="currentColor" /> Lancer
              </div>
            </div>

            {launching === item.ratingKey && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-amber-400" />
              </div>
            )}
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 text-sm">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded disabled:opacity-30 hover:bg-zinc-800 transition-colors"
          >Précédent</button>
          <span className="text-zinc-500 text-xs">
            Page {page + 1} / {totalPages} — {total} items
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded disabled:opacity-30 hover:bg-zinc-800 transition-colors"
          >Suivant</button>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded shadow-lg text-sm font-medium ${
          toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
