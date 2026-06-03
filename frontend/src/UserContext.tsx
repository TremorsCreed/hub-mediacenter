import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { api, User, setCurrentUserId, getCurrentUserId, setAdminToken, isAdminUnlocked } from './api'

interface UserContextValue {
  users: User[]
  currentUser: User | null
  loading: boolean
  refresh: () => Promise<void>
  selectUser: (u: User) => void
  switchProfile: () => void
  adminUnlocked: boolean
  unlockAdmin: (token: string) => void
  lockAdmin: () => void
}

const UserContext = createContext<UserContextValue | null>(null)

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [adminUnlocked, setAdminUnlocked] = useState(isAdminUnlocked())

  const refresh = useCallback(async () => {
    const list = await api.users.list().catch(() => [])
    setUsers(list)
    // Resynchronise le profil courant avec la liste (au cas où il a été supprimé)
    const savedId = getCurrentUserId()
    const found = savedId != null ? list.find(u => u.id === savedId) ?? null : null
    setCurrentUser(found)
    if (!found) setCurrentUserId(null)
    return
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const selectUser = useCallback((u: User) => {
    setCurrentUserId(u.id)
    setCurrentUser(u)
  }, [])

  const switchProfile = useCallback(() => {
    setCurrentUserId(null)
    setCurrentUser(null)
    setAdminToken(null)
    setAdminUnlocked(false)
  }, [])

  const unlockAdmin = useCallback((token: string) => {
    setAdminToken(token)
    setAdminUnlocked(true)
  }, [])

  const lockAdmin = useCallback(() => {
    setAdminToken(null)
    setAdminUnlocked(false)
  }, [])

  return (
    <UserContext.Provider value={{ users, currentUser, loading, refresh, selectUser, switchProfile, adminUnlocked, unlockAdmin, lockAdmin }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be used within UserProvider')
  return ctx
}

// Helper : initiales pour les avatars (1-2 lettres)
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
