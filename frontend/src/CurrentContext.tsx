import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { api, CurrentPick, CurrentInput } from './api'
import { useUser } from './UserContext'

interface CurrentContextValue {
  picks: CurrentPick[]
  isCurrent: (key: string) => boolean
  toggle: (item: CurrentInput) => Promise<void>
  refresh: () => Promise<void>
}

const CurrentContext = createContext<CurrentContextValue | null>(null)

export function CurrentProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useUser()
  const [picks, setPicks] = useState<CurrentPick[]>([])

  const refresh = useCallback(async () => {
    if (!currentUser) { setPicks([]); return }
    setPicks(await api.current.list().catch(() => []))
  }, [currentUser])

  useEffect(() => { refresh() }, [refresh])

  const keys = useMemo(() => new Set(picks.map(p => p.key)), [picks])
  const isCurrent = useCallback((key: string) => keys.has(key), [keys])

  const toggle = useCallback(async (item: CurrentInput) => {
    if (keys.has(item.key)) {
      setPicks(prev => prev.filter(p => p.key !== item.key))
      await api.current.remove(item.key).catch(refresh)
    } else {
      const optimistic: CurrentPick = { ...item, id: -Date.now(), created_at: Date.now() }
      setPicks(prev => [optimistic, ...prev])
      await api.current.add(item).catch(refresh)
      refresh()
    }
  }, [keys, refresh])

  return (
    <CurrentContext.Provider value={{ picks, isCurrent, toggle, refresh }}>
      {children}
    </CurrentContext.Provider>
  )
}

export function useCurrent(): CurrentContextValue {
  const ctx = useContext(CurrentContext)
  if (!ctx) throw new Error('useCurrent must be used within CurrentProvider')
  return ctx
}
