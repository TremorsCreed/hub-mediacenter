import { Check, Eye } from 'lucide-react'
import { WatchedInput } from '../api'
import { useWatched } from '../WatchedContext'

// Bouton « vu » réutilisable (pastille verte quand vu). N'ouvre pas la lecture de la carte.
export default function WatchedButton({ item, size = 15, className = '' }: { item: WatchedInput; size?: number; className?: string }) {
  const { isWatched, toggle } = useWatched()
  const active = isWatched(item.app, item.ref_id)

  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(item) }}
      title={active ? 'Marquer comme non vu' : 'Marquer comme vu'}
      aria-pressed={active}
      className={`tap-target flex items-center justify-center rounded-full backdrop-blur-sm transition-colors ${active ? 'bg-green-600/85 hover:bg-green-600' : 'bg-black/55 hover:bg-black/75'} ${className}`}
    >
      {active
        ? <Check size={size} className="text-white" strokeWidth={2.5} />
        : <Eye size={size} className="text-white/90" strokeWidth={2} />}
    </button>
  )
}
