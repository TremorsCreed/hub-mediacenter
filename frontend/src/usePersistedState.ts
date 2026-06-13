import { useState, useEffect, Dispatch, SetStateAction } from 'react'

// useState dont la valeur est persistée dans le navigateur (localStorage), pour
// retrouver le dernier état choisi après un refresh : tri, dernière catégorie /
// section / plateforme active, etc. Même signature que useState — y compris la
// forme fonctionnelle du setter (prev => next).
export function usePersistedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
  }, [key, value])
  return [value, setValue]
}
