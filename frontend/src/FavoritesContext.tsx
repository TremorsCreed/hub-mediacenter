import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { api, Favorite, FavoriteInput } from './api'
import { useUser } from './UserContext'

interface FavoritesContextValue {
  favorites: Favorite[]
  isFavorite: (app: string, ref_id: string) => boolean
  toggle: (fav: FavoriteInput) => Promise<void>
  refresh: () => Promise<void>
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

const key = (app: string, ref_id: string) => `${app}:${ref_id}`

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useUser()
  const [favorites, setFavorites] = useState<Favorite[]>([])

  const refresh = useCallback(async () => {
    if (!currentUser) { setFavorites([]); return }
    const list = await api.favorites.list().catch(() => [])
    setFavorites(list)
  }, [currentUser])

  useEffect(() => { refresh() }, [refresh])

  const keys = useMemo(() => new Set(favorites.map(f => key(f.app, f.ref_id))), [favorites])

  const isFavorite = useCallback((app: string, ref_id: string) => keys.has(key(app, ref_id)), [keys])

  const toggle = useCallback(async (fav: FavoriteInput) => {
    const k = key(fav.app, fav.ref_id)
    const exists = keys.has(k)
    // Optimiste
    if (exists) {
      setFavorites(prev => prev.filter(f => key(f.app, f.ref_id) !== k))
      await api.favorites.remove(fav.app, fav.ref_id).catch(refresh)
    } else {
      const optimistic: Favorite = { ...fav, id: -Date.now(), created_at: Date.now() }
      setFavorites(prev => [optimistic, ...prev])
      await api.favorites.add(fav).catch(refresh)
      refresh() // récupère l'id réel
    }
  }, [keys, refresh])

  return (
    <FavoritesContext.Provider value={{ favorites, isFavorite, toggle, refresh }}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider')
  return ctx
}
