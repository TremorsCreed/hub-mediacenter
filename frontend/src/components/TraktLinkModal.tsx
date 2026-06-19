import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { X, Loader2, ExternalLink, Check, AlertTriangle } from 'lucide-react'

// Liaison d'un compte Trakt à un profil via le device flow (idéal TV) : on affiche
// un code que l'utilisateur saisit sur trakt.tv/activate, et on poll jusqu'à liaison.
export default function TraktLinkModal({ userId, name, onClose, onLinked }: {
  userId: number; name: string; onClose: () => void; onLinked: () => void
}) {
  const [start, setStart] = useState<{ user_code: string; verification_url: string; device_code: string; interval: number } | null>(null)
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'linked' | 'expired' | 'denied' | 'error'>('loading')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    api.trakt.auth.deviceStart(userId).then(s => {
      if (cancelled) return
      setStart(s); setPhase('waiting')
      const poll = async () => {
        try {
          const r = await api.trakt.auth.devicePoll(s.device_code)
          if (cancelled) return
          if (r.status === 'linked') { setPhase('linked'); setTimeout(onLinked, 900); return }
          if (r.status === 'pending') { timer.current = setTimeout(poll, (s.interval || 5) * 1000); return }
          setPhase(r.status) // expired | denied | error
        } catch {
          if (!cancelled) timer.current = setTimeout(poll, (s.interval || 5) * 1000)
        }
      }
      timer.current = setTimeout(poll, (s.interval || 5) * 1000)
    }).catch(() => { if (!cancelled) setPhase('error') })
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current) }
  }, [userId])

  return (
    <div className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h3 className="font-semibold">Lier Trakt · {name}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1"><X size={18} /></button>
        </div>

        <div className="p-6 text-center space-y-4">
          {phase === 'loading' && <div className="flex justify-center py-6"><Loader2 size={22} className="animate-spin text-zinc-500" /></div>}

          {phase === 'waiting' && start && (
            <>
              <p className="text-sm text-zinc-400">Sur ton téléphone ou ton ordi, va sur cette page et entre le code :</p>
              <a href={start.verification_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 text-sm">
                {start.verification_url.replace(/^https?:\/\//, '')} <ExternalLink size={13} />
              </a>
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg py-4">
                <div className="text-3xl font-bold tracking-[0.3em] text-zinc-100">{start.user_code}</div>
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
                <Loader2 size={13} className="animate-spin" /> En attente de validation…
              </div>
            </>
          )}

          {phase === 'linked' && (
            <div className="py-6 space-y-2">
              <div className="w-12 h-12 rounded-full bg-green-500/15 text-green-400 flex items-center justify-center mx-auto"><Check size={24} /></div>
              <p className="text-sm text-green-400">Compte Trakt lié à {name}.</p>
            </div>
          )}

          {(phase === 'expired' || phase === 'denied' || phase === 'error') && (
            <div className="py-6 space-y-2">
              <div className="w-12 h-12 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center mx-auto"><AlertTriangle size={22} /></div>
              <p className="text-sm text-red-400">
                {phase === 'expired' ? 'Le code a expiré. Réessaie.' : phase === 'denied' ? 'Liaison refusée sur Trakt.' : 'Échec de la liaison.'}
              </p>
              <button onClick={onClose} className="text-xs text-zinc-400 hover:text-zinc-200 underline">Fermer</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
