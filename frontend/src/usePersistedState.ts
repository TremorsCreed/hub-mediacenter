import { useState, useEffect } from 'react'

// useState dont la valeur est persistée dans le navigateur (localStorage), pour
// retrouver le dernier état choisi après un refresh : tri, dernière catégorie /
// section / plateforme active, etc. Même signature que useState.
export function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
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
