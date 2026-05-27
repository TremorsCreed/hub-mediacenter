import { useEffect, useMemo, useState } from 'react'
import { api, Device, PlexItem, PlexOnDeckItem, PlexSection } from '../api'
import { Search, Play, Loader2, AlertCircle, RotateCcw } from 'lucide-react'

const PAGE_SIZE = 60

function progressPct(it: { viewOffset?: number; duration?: number }): number {
  if (!it.viewOffset || !it.duration) return 0
  return Math.min(100, Math.max(0, (it.viewOffset / it.duration) * 100))
}

function fmtRemaining(it: { viewOffset?: number; duration?: number }): string {
  if (!it.viewOffset || !it.duration) return ''
  const remainMs = Math.max(0, it.duration - it.viewOffset)
  const min = Math.round(remainMs / 60000)
  return min < 60 ? `${min} min restantes` : `${Math.floor(min / 60)}h${(min % 60).toString().padStart(2, '0')}`
}

export default function Plex() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [sections, setSections] = useState<PlexSection[]>([])
  const [sectionId, setSectionId] = useState<string>('')
  const [items, setItems] = useState<PlexItem[]>([])
  const [onDeck, setOnDeck] = useState<PlexOnDeckItem[]>([])
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
      if (s.connected) {
        api.plex.sections().then(setSections)
        api.plex.onDeck().then(setOnDeck).catch(() => {})
      }
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

  const play = async (item: PlexItem, opts: { resume?: boolean } = {}) => {
    if (!deviceId) {
      setToast({ msg: 'Sélectionne un device', ok: false })
      return
    }
    setLaunching(item.ratingKey)
    try {
      const r = await api.play({
        plex_id: item.ratingKey,
        title: item.title,
        thumb: item.thumb,
        resume: opts.resume,
        app: 'plex',
        device_id: deviceId,
        requester: 'manual',
      })
      setToast({ msg: `${opts.resume ? '⟲' : '▶'} ${r.title}`, ok: true })
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

      {/* En cours (onDeck) : visible quand on est sur la section courante (heuristique : qu'il y a des en-cours) */}
      {onDeck.length > 0 && page === 0 && !debouncedSearch && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <RotateCcw size={14} className="text-amber-400" />
            <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">Reprendre</h2>
            <span className="text-xs text-zinc-600">{onDeck.length}</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-3 -mx-2 px-2 snap-x">
            {onDeck.map(item => {
              const pct = progressPct(item)
              const subtitle = item.grandparentTitle
                ? `${item.grandparentTitle} · S${item.parentIndex ?? '?'}E${item.index ?? '?'}`
                : (item.year ? String(item.year) : '')
              return (
                <button
                  key={`ondeck-${item.ratingKey}`}
                  onClick={() => play(item, { resume: true })}
                  disabled={launching === item.ratingKey}
                  className="group relative shrink-0 w-[260px] aspect-[16/9] bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50 snap-start"
                >
                  {item.thumb && (
                    <img src={api.plex.imageUrl(item.thumb)} alt={item.title} loading="lazy"
                         className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-end p-3">
                    <div className="text-sm font-semibold line-clamp-1">{item.title}</div>
                    {subtitle && <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">{subtitle}</div>}
                    <div className="text-[10px] text-amber-400 mt-1">{fmtRemaining(item)}</div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800/80">
                    <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                  {launching === item.ratingKey && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                      <Loader2 size={22} className="animate-spin text-amber-400" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {items.map(item => {
          const inProgress = (item.viewOffset ?? 0) > 0
          const pct = progressPct(item)
          return (
            <div key={item.ratingKey} className="relative">
              <button
                onClick={() => play(item, { resume: inProgress })}
                disabled={launching === item.ratingKey}
                className="group relative aspect-[2/3] w-full bg-zinc-900 border border-zinc-800 rounded overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50"
              >
                {item.thumb ? (
                  <img src={api.plex.imageUrl(item.thumb)} alt={item.title} loading="lazy"
                       className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs p-2 text-center">{item.title}</div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                  <div className="text-xs font-medium line-clamp-2">{item.title}</div>
                  {item.year && <div className="text-[10px] text-zinc-400 mt-0.5">{item.year}</div>}
                  <div className="flex items-center gap-1 mt-1.5 text-amber-400 text-xs">
                    {inProgress ? <><RotateCcw size={10} /> Reprendre</> : <><Play size={11} fill="currentColor" /> Lancer</>}
                  </div>
                </div>

                {inProgress && pct > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/70">
                    <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                )}

                {launching === item.ratingKey && (
                  <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-amber-400" />
                  </div>
                )}
              </button>

              {/* Mini bouton "recommencer du début" sur les en-cours (visible au hover) */}
              {inProgress && (
                <button
                  onClick={() => play(item, { resume: false })}
                  disabled={launching === item.ratingKey}
                  className="absolute top-1.5 right-1.5 z-10 opacity-0 hover:opacity-100 group-hover:opacity-100 bg-zinc-900/90 border border-zinc-700 hover:border-amber-500/60 text-amber-400 rounded px-1.5 py-1 text-[10px] flex items-center gap-1 transition-opacity"
                  title="Recommencer du début"
                >
                  <Play size={9} fill="currentColor" />
                </button>
              )}
            </div>
          )
        })}
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
