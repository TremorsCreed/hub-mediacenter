import { ReactNode, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useUser } from '../UserContext'
import { Lock, Loader2, ArrowLeft } from 'lucide-react'

// Barrière PIN : tant que l'admin n'est pas déverrouillé, on affiche la saisie du PIN.
export default function AdminGate({ children }: { children: ReactNode }) {
  const { adminUnlocked, unlockAdmin } = useUser()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (adminUnlocked) return <>{children}</>

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin || loading) return
    setLoading(true)
    setError(null)
    try {
      const r = await api.users.verifyPin(pin)
      unlockAdmin(r.token)
    } catch (err: any) {
      setError(err.message || 'PIN incorrect')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-zinc-950 px-6">
      <div className="w-full max-w-xs flex flex-col items-center">
        <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-5">
          <Lock size={22} className="text-amber-400" />
        </div>
        <h1 className="text-lg font-semibold text-zinc-100 mb-1">Section Admin</h1>
        <p className="text-sm text-zinc-500 mb-6 text-center">Saisis le PIN administrateur pour continuer.</p>

        <form onSubmit={submit} className="w-full flex flex-col gap-3">
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="••••"
            className="w-full text-center tracking-[0.5em] text-lg bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-amber-500/60"
          />
          {error && <div className="text-xs text-red-400 text-center">{error}</div>}
          <button
            type="submit"
            disabled={loading || !pin}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 text-black font-medium rounded-lg px-4 py-2.5 hover:bg-amber-400 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Déverrouiller'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/catalog')}
            className="flex items-center justify-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-1"
          >
            <ArrowLeft size={12} /> Retour au catalogue
          </button>
        </form>
      </div>
    </div>
  )
}
