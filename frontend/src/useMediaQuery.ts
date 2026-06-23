import { useEffect, useState } from 'react'

// Réagit à une media query CSS côté JS (ex. savoir si on est en « mobile » pour
// piloter un drawer/sheet). Le rendu purement visuel reste géré par les préfixes
// Tailwind (md:…) ; ce hook ne sert qu'à la logique (état d'ouverture, focus…).
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// Raccourci : vrai sous le breakpoint md de Tailwind (< 768px), notre bascule mobile.
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)')
}
