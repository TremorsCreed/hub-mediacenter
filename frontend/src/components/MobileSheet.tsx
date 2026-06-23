import { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useModalA11y } from '../useModalA11y'

// Panneau coulissant mobile (slide-over) pour héberger ce qui, sur desktop, vit dans
// une sidebar latérale (sections Plex, catégories IPTV, filtres…). On le déclenche
// depuis un bouton de l'en-tête mobile. Scrim, Échap, piège de focus via useModalA11y.
export default function MobileSheet({
  open, onClose, title, side = 'left', children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  side?: 'left' | 'right'
  children: ReactNode
}) {
  const ref = useModalA11y(open, onClose)
  if (!open) return null
  const slide = side === 'left' ? 'left-0 border-r' : 'right-0 border-l'
  return createPortal(
    <div className="fixed inset-0 z-[60] md:hidden">
      <div className="absolute inset-0 bg-black/60 animate-[fadein_150ms_ease-out]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`absolute inset-y-0 ${slide} w-[82vw] max-w-[320px] bg-zinc-900 border-zinc-800 flex flex-col shadow-2xl
          ${side === 'left' ? 'animate-[slidein-left_200ms_ease-out]' : 'animate-[slidein-right_200ms_ease-out]'}`}
      >
        <div className="h-[53px] shrink-0 border-b border-zinc-800 flex items-center gap-2 px-4">
          <div className="flex-1 text-sm font-semibold text-zinc-200 truncate">{title}</div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="w-11 h-11 -mr-2 flex items-center justify-center text-zinc-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
