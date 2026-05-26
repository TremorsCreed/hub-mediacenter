import { useEffect, useState } from 'react'
import { api, HistoryEntry } from '../api'

const REQUESTER_COLOR: Record<string, string> = {
  zaparoo: 'text-purple-400',
  llm: 'text-blue-400',
  n8n: 'text-orange-400',
  ha: 'text-green-400',
  manual: 'text-zinc-400'
}

export default function History() {
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    api.state.history().then(setHistory)
    const t = setInterval(() => api.state.history().then(setHistory), 10000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">History</h1>

      {history.length === 0 && (
        <div className="text-sm text-zinc-600 py-8 text-center">No playback history yet.</div>
      )}

      <div className="space-y-1.5">
        {history.map(h => (
          <div key={h.id} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
            <div>
              <div className="text-sm font-medium">{h.title ?? h.catalog_id ?? 'Unknown'}</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {h.device_name ?? h.device_id} · {h.app}
              </div>
            </div>
            <div className="text-right">
              <div className={`text-xs font-medium ${REQUESTER_COLOR[h.requester] ?? 'text-zinc-400'}`}>
                {h.requester}
              </div>
              <div className="text-xs text-zinc-600 mt-0.5">
                {new Date(h.started_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
