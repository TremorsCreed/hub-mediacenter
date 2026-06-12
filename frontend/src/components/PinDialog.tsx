import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Lock, Loader2 } from 'lucide-react'
import { api } from '../api'

// Demande le PIN (parental) pour déverrouiller quelque chose. Vérifie côté
// serveur via /users/check-pin (sans émettre de token admin).
export default function PinDialog({ title, onSuccess, onCancel }: {
  title: string
  onSuccess: () => void
  onCancel: () => void
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async () => {
    if (!pin || checking) return
    setChecking(true)
    setError(false)
    try {
      await api.users.checkPin(pin)
      onSuccess()
    } catch {
      setError(true)
      setPin('')
      inputRef.current?.focus()
    } finally {
      setChecking(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={onCancel}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-80 flex flex-col items-center gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center">
          <Lock size={20} className="text-amber-400" />
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-white">{title}</div>
          <div className="text-xs text-zinc-500 mt-1">Entre le PIN pour continuer</div>
        </div>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={e => { setPin(e.target.value); setError(false) }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
          className={`w-32 text-center tracking-[0.5em] bg-zinc-950 border rounded-lg px-3 py-2 text-lg focus:outline-none ${
            error ? 'border-red-500' : 'border-zinc-700 focus:border-amber-500'
          }`}
        />
        {error && <div className="text-xs text-red-400 -mt-2">PIN incorrect</div>}
        <div className="flex gap-2 w-full">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={!pin || checking}
            className="flex-1 py-2 text-sm rounded-lg bg-amber-500 text-black font-medium hover:bg-amber-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {checking && <Loader2 size={13} className="animate-spin" />}
            Déverrouiller
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
