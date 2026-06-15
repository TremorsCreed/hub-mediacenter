import { Bookmark } from 'lucide-react'
import { CurrentInput } from '../api'
import { useCurrent } from '../CurrentContext'

// Bouton « Favori du moment » / en cours : épingle une série ou playlist pour la
// retrouver dans la rangée « En cours » du dashboard. N'ouvre pas la lecture de la carte.
export default function CurrentButton({ item, label, size = 16, className = '' }: { item: CurrentInput; label?: string; size?: number; className?: string }) {
  const { isCurrent, toggle } = useCurrent()
  const active = isCurrent(item.key)
  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(item) }}
      title={active ? 'Retirer de « En cours »' : 'Marquer comme « En cours »'}
      aria-pressed={active}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors ${active ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-amber-400'} ${className}`}
    >
      <Bookmark size={size} fill={active ? 'currentColor' : 'none'} />
      {label && <span className="text-sm">{active ? 'En cours' : label}</span>}
    </button>
  )
}
