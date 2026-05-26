import { useEffect, useState } from 'react'
import { api, Device, CatalogEntry } from '../api'
import { Send } from 'lucide-react'

export default function PlayPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [results, setResults] = useState<CatalogEntry[]>([])
  const [q, setQ] = useState('')
  const [selectedMedia, setSelectedMedia] = useState<CatalogEntry | null>(null)
  const [selectedDevice, setSelectedDevice] = useState('')
  const [requester, setRequester] = useState('manual')
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    api.devices.list().then(d => setDevices(d.filter(x => x.ws_connected)))
  }, [])

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const t = setTimeout(() => api.catalog.search(q).then(setResults), 300)
    return () => clearTimeout(t)
  }, [q])

  const send = async () => {
    if (!selectedMedia) return
    setSending(true)
    setStatus(null)
    try {
      const res = await api.play({
        catalog_id: selectedMedia.id,
        device_id: selectedDevice || undefined,
        requester: requester as any
      })
      setStatus({ ok: true, msg: `Playing "${res.title}" on ${res.device_id} via ${res.app}` })
    } catch (e: any) {
      setStatus({ ok: false, msg: e.message })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5 max-w-lg">
      <h1 className="text-xl font-semibold">Play</h1>
      <p className="text-sm text-zinc-500">Send a play command manually — useful for testing and integration.</p>

      <div>
        <label className="text-xs text-zinc-500 block mb-1.5">Search media</label>
        <input
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-600"
          placeholder="The Fellowship of the Ring..."
          value={q} onChange={e => { setQ(e.target.value); setSelectedMedia(null) }}
        />
        {results.length > 0 && !selectedMedia && (
          <div className="mt-1 bg-zinc-900 border border-zinc-700 rounded overflow-hidden">
            {results.map(r => (
              <button
                key={r.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800 transition-colors flex justify-between items-center"
                onClick={() => { setSelectedMedia(r); setQ(r.title); setResults([]) }}
              >
                <span>{r.title}</span>
                <span className="text-xs text-zinc-600">{r.type}</span>
              </button>
            ))}
          </div>
        )}
        {selectedMedia && (
          <div className="mt-1.5 text-xs text-green-400">
            Selected: {selectedMedia.title} ({selectedMedia.type})
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-zinc-500 block mb-1.5">Target device</label>
        <select
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none"
          value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)}
        >
          <option value="">Auto (first available)</option>
          {devices.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {devices.length === 0 && (
          <div className="text-xs text-zinc-600 mt-1">No agents connected.</div>
        )}
      </div>

      <div>
        <label className="text-xs text-zinc-500 block mb-1.5">Requester</label>
        <select
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none"
          value={requester} onChange={e => setRequester(e.target.value)}
        >
          {['manual', 'zaparoo', 'llm', 'n8n', 'ha'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <button
        onClick={send}
        disabled={!selectedMedia || sending}
        className="flex items-center gap-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 rounded text-sm transition-colors"
      >
        <Send size={13} /> {sending ? 'Sending...' : 'Send'}
      </button>

      {status && (
        <div className={`text-sm px-3 py-2 rounded border ${status.ok ? 'bg-green-950 border-green-800 text-green-300' : 'bg-red-950 border-red-800 text-red-300'}`}>
          {status.msg}
        </div>
      )}
    </div>
  )
}
