import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { api, WatchedItem, WatchedInput } from './api'
import { useUser } from './UserContext'

interface WatchedContextValue {
  watched: WatchedItem[]
  isWatched: (app: string, ref_id: string) => boolean
  toggle: (item: WatchedInput) => Promise<void>
  markMany: (items: WatchedInput[]) => Promise<void>
  unmarkMany: (app: string, ref_ids: string[]) => Promise<void>
  refresh: () => Promise<void>
}

const WatchedContext = createContext<WatchedContextValue | null>(null)
const key = (app: string, ref_id: string) => `${app}:${ref_id}`

export function WatchedProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useUser()
  const [watched, setWatched] = useState<WatchedItem[]>([])

  const refresh = useCallback(async () => {
    if (!currentUser) { setWatched([]); return }
    setWatched(await api.watched.list().catch(() => []))
  }, [currentUser])

  useEffect(() => { refresh() }, [refresh])

  const keys = useMemo(() => new Set(watched.map(w => key(w.app, w.ref_id))), [watched])
  const isWatched = useCallback((app: string, ref_id: string) => keys.has(key(app, ref_id)), [keys])

  const toggle = useCallback(async (item: WatchedInput) => {
    const k = key(item.app, item.ref_id)
    if (keys.has(k)) {
      setWatched(prev => prev.filter(w => key(w.app, w.ref_id) !== k))
      await api.watched.remove(item.app, item.ref_id).catch(refresh)
    } else {
      const optimistic: WatchedItem = { ...item, id: -Date.now(), watched_at: Date.now() }
      setWatched(prev => [optimistic, ...prev])
      await api.watched.add(item).catch(refresh)
      refresh()
    }
  }, [keys, refresh])

  // Marque/retire un lot (ex. tous les épisodes d'une saison).
  const markMany = useCallback(async (items: WatchedInput[]) => {
    if (!items.length) return
    const now = Date.now()
    setWatched(prev => {
      const have = new Set(prev.map(w => key(w.app, w.ref_id)))
      const add = items.filter(it => !have.has(key(it.app, it.ref_id))).map(it => ({ ...it, id: -now - Math.random(), watched_at: now }))
      return [...add, ...prev]
    })
    await api.watched.addBulk(items).catch(() => {})
    refresh()
  }, [refresh])

  const unmarkMany = useCallback(async (app: string, ref_ids: string[]) => {
    if (!ref_ids.length) return
    const rm = new Set(ref_ids.map(r => key(app, r)))
    setWatched(prev => prev.filter(w => !rm.has(key(w.app, w.ref_id))))
    await api.watched.removeBulk(app, ref_ids).catch(refresh)
  }, [refresh])

  return (
    <WatchedContext.Provider value={{ watched, isWatched, toggle, markMany, unmarkMany, refresh }}>
      {children}
    </WatchedContext.Provider>
  )
}

export function useWatched(): WatchedContextValue {
  const ctx = useContext(WatchedContext)
  if (!ctx) throw new Error('useWatched must be used within WatchedProvider')
  return ctx
}
