import { useEffect, useRef } from 'react'

// Pile des modales actives : seule celle du dessus réagit à Échap, pour ne pas
// fermer plusieurs niveaux d'un coup quand des modales sont imbriquées.
const stack: number[] = []
let counter = 0

// Accessibilité clavier/télécommande pour une modale :
//  - Échap ferme (uniquement la modale du dessus)
//  - le focus est piégé dans la modale (Tab / Shift+Tab bouclent)
//  - focus initial sur le 1er élément focusable (ou [data-autofocus])
//  - le focus revient à l'élément précédent à la fermeture
// Retourne une ref à poser sur le conteneur de la modale.
export function useModalA11y(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  // onClose via ref : évite de relancer l'effet (et de voler le focus) à chaque
  // rendu quand le parent passe une closure inline.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!active) return
    const id = ++counter
    stack.push(id)
    const node = ref.current
    const prevFocus = document.activeElement as HTMLElement | null
    const isTop = () => stack[stack.length - 1] === id
    const SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key === 'Tab' && node) {
        const f = Array.from(node.querySelectorAll<HTMLElement>(SEL)).filter(el => el.offsetParent !== null)
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)

    const toFocus = node?.querySelector<HTMLElement>('[data-autofocus]')
      ?? node?.querySelector<HTMLElement>(SEL)
    toFocus?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      prevFocus?.focus?.()
    }
  }, [active])

  return ref
}
