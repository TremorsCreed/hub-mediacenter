import { useEffect, useMemo, useState } from 'react'
import { api, Device, IptvCategory, IptvStream } from '../api'
import { Search, Play, Loader2, AlertCircle, Tv, Film } from 'lucide-react'

export default function Iptv() {
  const [creds, setCreds] = useState<{ id: number; name: string }[]>([])
  const [credId, setCredId] = useState<number | null>(null)
  const [type, setType] = useState<'live' | 'vod'>('live')
  const [categories, setCategories] = useState<IptvCategory[]>([])
  const [categoryId, setCategoryId] = useState<string>('')
  const [streams, setStreams] = useState<IptvStream[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [launching, setLaunching] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    api.iptv.credentials().then(c => {
      setCreds(c)
      if (c.length) setCredId(c[0].id)
    })
    api.devices.list().then(ds => {
      setDevices(ds)
      const connectedDev = ds.find(d => d.ws_connected)
      if (connectedDev) setDeviceId(connectedDev.id)
    })
  }, [])

  useEffect(() => {
    if (!credId) return
    setCategoryId('')
    api.iptv.categories(credId, type).then(setCategories).catch(() => setCategories([]))
  }, [credId, type])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!credId) return
    setLoading(true)
    api.iptv.streams(credId, {
      type,
      category: categoryId || undefined,
      search: debouncedSearch || undefined,
      limit: 300,
    })
      .then(r => { setStreams(r.items); setTotal(r.total) })
      .catch(() => { setStreams([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [credId, type, categoryId, debouncedSearch])

  const play = async (s: IptvStream) => {
    if (!deviceId) {
      setToast({ msg: 'Sélectionne un device', ok: false })
      return
    }
    setLaunching(s.stream_id)
    try {
      const r = await api.play({
        iptv_stream_id: s.stream_id,
        iptv_type: s.type,
        title: s.name,
        app: 'iptv',
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

  const shownCount = useMemo(() => streams.length, [streams])

  if (creds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3">
        <AlertCircle size={32} />
        <div className="text-sm">Aucun profil IPTV.</div>
        <a href="/credentials" className="text-amber-400 hover:text-amber-300 text-sm underline">Créer un profil Xtream</a>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold mr-auto">IPTV</h1>

        <select
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
          value={credId ?? ''}
          onChange={e => setCredId(Number(e.target.value))}
        >
          {creds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div className="flex bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
          <button
            onClick={() => setType('live')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${type === 'live' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            <Tv size={13} /> Live
          </button>
          <button
            onClick={() => setType('vod')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${type === 'vod' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            <Film size={13} /> VOD
          </button>
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

      <div className="flex gap-2 flex-wrap">
        <select
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600 max-w-xs"
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
        >
          <option value="">Toutes les catégories ({categories.length})</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 pl-8 text-sm focus:outline-none focus:border-zinc-600"
            placeholder={type === 'live' ? 'Rechercher une chaîne…' : 'Rechercher un film…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading && streams.length === 0 && (
        <div className="flex items-center justify-center py-16 text-zinc-600 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Chargement…
        </div>
      )}

      {!loading && streams.length === 0 && (
        <div className="text-sm text-zinc-600 py-16 text-center">Aucun résultat.</div>
      )}

      {type === 'live' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {streams.map(s => (
            <button
              key={s.stream_id}
              onClick={() => play(s)}
              disabled={launching === s.stream_id}
              className="group flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded p-2 hover:border-amber-500/60 transition-colors text-left disabled:opacity-50"
            >
              <div className="w-12 h-12 shrink-0 bg-zinc-800 rounded overflow-hidden flex items-center justify-center">
                {s.logo ? (
                  <img src={api.iptv.imageUrl(s.logo)} alt="" loading="lazy" className="w-full h-full object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />
                ) : (
                  <Tv size={18} className="text-zinc-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{s.name}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Live · #{s.stream_id}</div>
              </div>
              {launching === s.stream_id
                ? <Loader2 size={14} className="animate-spin text-amber-400" />
                : <Play size={12} className="text-zinc-600 group-hover:text-amber-400 transition-colors" fill="currentColor" />
              }
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {streams.map(s => (
            <button
              key={s.stream_id}
              onClick={() => play(s)}
              disabled={launching === s.stream_id}
              className="group relative aspect-[2/3] bg-zinc-900 border border-zinc-800 rounded overflow-hidden hover:border-amber-500/60 transition-colors text-left disabled:opacity-50"
            >
              {s.logo ? (
                <img src={api.iptv.imageUrl(s.logo)} alt={s.name} loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs p-2 text-center">{s.name}</div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                <div className="text-xs font-medium line-clamp-2">{s.name}</div>
                {s.year && <div className="text-[10px] text-zinc-400 mt-0.5">{s.year}</div>}
                <div className="flex items-center gap-1 mt-1.5 text-amber-400 text-xs">
                  <Play size={11} fill="currentColor" /> Lancer
                </div>
              </div>
              {launching === s.stream_id && (
                <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-amber-400" />
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {shownCount > 0 && (
        <div className="text-xs text-zinc-600 text-center pt-2">
          {shownCount} affichés{shownCount < total ? ` sur ${total} — affine la recherche pour voir plus` : ''}
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
