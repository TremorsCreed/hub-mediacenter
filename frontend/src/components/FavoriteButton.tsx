import { Heart } from 'lucide-react'
import { FavoriteInput } from '../api'
import { useFavorites } from '../FavoritesContext'

// Bouton cœur réutilisable. Empêche le clic de déclencher la lecture de la carte.
export default function FavoriteButton({ fav, size = 15, className = '' }: { fav: FavoriteInput; size?: number; className?: string }) {
  const { isFavorite, toggle } = useFavorites()
  const active = isFavorite(fav.app, fav.ref_id)

  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(fav) }}
      title={active ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={`tap-target flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm hover:bg-black/75 transition-colors ${className}`}
    >
      <Heart
        size={size}
        className={active ? 'text-red-500' : 'text-white/90'}
        fill={active ? 'currentColor' : 'none'}
        strokeWidth={2}
      />
    </button>
  )
}
