import { useEffect, useState, useRef } from 'react'
import { api } from '../api'
import { CheckCircle, Circle, ExternalLink, LogOut, RefreshCw } from 'lucide-react'

export default function Settings() {
  const [status, setStatus] = useState<{ connected: boolean; server_url: string | null; server_machine_id: string | null } | null>(null)
  const [pin, setPin] = useState<{ pin: string; auth_url: string; id: number } | null>(null)
  const [polling, setPolling] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadStatus = async () => {
    const s = await api.plex.status()
    setStatus(s)
  }

  useEffect(() => {
    loadStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const startAuth = async () => {
    const data = await api.plex.startPin()
    setPin(data)
    setPolling(true)
    pollRef.current = setInterval(async () => {
      const result = await api.plex.pollPin(data.id)
      if (result.done) {
        clearInterval(pollRef.current!)
        setPolling(false)
        setPin(null)
        await loadStatus()
      }
    }, 2500)
  }

  const disconnect = async () => {
    await api.plex.disconnect()
    setStatus(s => s ? { ...s, connected: false, server_url: null, server_machine_id: null } : null)
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <img src="https://www.plex.tv/wp-content/themes/plex/img/plex-icon.png" className="w-5 h-5 rounded" onError={e => (e.currentTarget.style.display = 'none')} />
          <span className="font-medium text-sm">Plex</span>
          {status?.connected
            ? <span className="ml-auto flex items-center gap-1 text-xs text-green-400"><CheckCircle size={12} /> Connecté</span>
            : <span className="ml-auto flex items-center gap-1 text-xs text-zinc-500"><Circle size={12} /> Non connecté</span>
          }
        </div>

        {status?.connected && (
          <div className="text-xs text-zinc-500 space-y-1">
            {status.server_url && <div>Serveur : <span className="text-zinc-300 font-mono">{status.server_url}</span></div>}
            {status.server_machine_id && <div>Machine ID : <span className="text-zinc-300 font-mono text-xs">{status.server_machine_id}</span></div>}
          </div>
        )}

        {pin && (
          <div className="bg-zinc-800 rounded-lg p-4 space-y-3">
            <div className="text-xs text-zinc-400">
              Entre ce code sur plex.tv pour autoriser le Hub :
            </div>
            <div className="text-3xl font-mono font-bold tracking-widest text-white text-center py-2">
              {pin.pin}
            </div>
            <a
              href={pin.auth_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              <ExternalLink size={14} />
              Ouvrir plex.tv pour autoriser
            </a>
            <div className="flex items-center gap-2 text-xs text-zinc-500 justify-center">
              <RefreshCw size={11} className="animate-spin" />
              En attente de l'autorisation…
            </div>
          </div>
        )}

        {!status?.connected && !pin && (
          <button
            onClick={startAuth}
            disabled={polling}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-medium px-4 py-2 rounded transition-colors"
          >
            Connecter Plex
          </button>
        )}

        {status?.connected && (
          <button
            onClick={disconnect}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-400 transition-colors"
          >
            <LogOut size={12} />
            Déconnecter
          </button>
        )}
      </div>
    </div>
  )
}
