import { createPortal } from 'react-dom'
import { CheckCircle2, AlertCircle } from 'lucide-react'

// Toast accessible : annoncé aux lecteurs d'écran (role/aria-live) et lisible
// sans la couleur seule (icône check/croix en plus du vert/rouge).
export default function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return createPortal(
    <div
      role={ok ? 'status' : 'alert'}
      aria-live={ok ? 'polite' : 'assertive'}
      className={`fixed bottom-6 right-6 z-[110] flex items-center gap-2 px-4 py-2.5 rounded shadow-lg text-sm font-medium text-white ${
        ok ? 'bg-success' : 'bg-danger'
      }`}
    >
      {ok ? <CheckCircle2 size={16} className="shrink-0" /> : <AlertCircle size={16} className="shrink-0" />}
      <span>{msg}</span>
    </div>,
    document.body,
  )
}
