import { useCallback, useEffect, useState } from 'react'
import { api, HistoryEntry } from '../api'
import { useUser, initials } from '../UserContext'
import { Trash2, X } from 'lucide-react'

const REQUESTER_COLOR: Record<string, string> = {
  zaparoo: 'text-purple-400',
  llm: 'text-blue-400',
  n8n: 'text-orange-400',
  ha: 'text-green-400',
  manual: 'text-zinc-400'
}

export default function History() {
  const { adminUnlocked, users, currentUser } = useUser()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [filter, setFilter] = useState<string>('all') // pour l'admin : 'all' | userId

  // Un membre ne voit que le sien (le backend filtre via X-User-Id). L'admin filtre via ?user_id.
  const load = useCallback(() => {
    const f = adminUnlocked ? filter : undefined
    api.state.history(f).then(setHistory).catch(() => {})
  }, [adminUnlocked, filter])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  const deleteOne = async (id: number) => {
    setHistory(h => h.filter(x => x.id !== id)) // optimiste
    await api.state.deleteHistory(id).catch(load)
  }

  const clearAll = async () => {
    const scope = adminUnlocked
      ? (filter === 'all' ? 'tout l\'historique de tous les profils' : 'l\'historique de ce profil')
      : 'ton historique'
    if (!confirm(`Effacer ${scope} ? Cette action est irréversible.`)) return
    await api.state.clearHistory(adminUnlocked ? filter : undefined).catch(() => {})
    load()
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight mr-auto">Historique</h1>

        {adminUnlocked && (
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
          >
            <option value="all">Tous les profils</option>
            {users.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </select>
        )}

        {history.length > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} /> Tout effacer
          </button>
        )}
      </div>

      {history.length === 0 && (
        <div className="text-sm text-zinc-600 py-8 text-center">Aucun historique de lecture.</div>
      )}

      <div className="space-y-1.5">
        {history.map(h => {
          const showUser = adminUnlocked && filter === 'all' && h.user_name
          return (
            <div key={h.id} className="group flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
              {showUser && (
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-semibold text-black/80 shrink-0"
                  style={{ backgroundColor: h.user_color ?? '#64748b' }}
                  title={h.user_name}
                >
                  {initials(h.user_name!)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{h.title ?? h.catalog_id ?? 'Inconnu'}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {h.device_name ?? h.device_id} · {h.app}
                  {showUser && <span className="text-zinc-600"> · {h.user_name}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-xs font-medium ${REQUESTER_COLOR[h.requester] ?? 'text-zinc-400'}`}>
                  {h.requester}
                </div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  {new Date(h.started_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => deleteOne(h.id)}
                className="tap-target reveal text-zinc-600 hover:text-red-400 p-1 shrink-0"
                title="Supprimer cette entrée"
              >
                <X size={15} />
              </button>
            </div>
          )
        })}
      </div>

      {currentUser && !adminUnlocked && (
        <p className="text-[11px] text-zinc-600 pt-2">Tu vois uniquement ton propre historique ({currentUser.name}).</p>
      )}
    </div>
  )
}
