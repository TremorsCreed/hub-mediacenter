// Skeletons de chargement : perçus comme plus rapides qu'un spinner pour les
// listes longues (l'utilisateur voit la forme de la grille se remplir).
// animate-pulse est figé par prefers-reduced-motion (règle globale du Lot 1).

// Grille de jaquettes (films / séries / Plex).
export function PosterSkeletons({ count = 18 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-[2/3] rounded bg-surface-2 animate-pulse" />
      ))}
    </div>
  )
}

// Grille de chaînes TV (vignette + libellé).
export function ChannelSkeletons({ count = 18 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 bg-surface border border-border rounded p-2">
          <div className="w-12 h-12 shrink-0 rounded bg-surface-2 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/4 rounded bg-surface-2 animate-pulse" />
            <div className="h-2 w-1/3 rounded bg-surface-2 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}
