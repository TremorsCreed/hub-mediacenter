import { useUser, initials } from '../UserContext'
import { ShieldCheck } from 'lucide-react'

export default function ProfileSelect() {
  const { users, selectUser, loading } = useUser()

  if (loading) return null

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-zinc-950 px-6">
      <h1 className="text-2xl font-light tracking-wide text-zinc-200 mb-12">Qui regarde&nbsp;?</h1>

      <div className="flex flex-wrap items-start justify-center gap-8 max-w-3xl">
        {users.map(u => (
          <button
            key={u.id}
            onClick={() => selectUser(u)}
            className="group flex flex-col items-center gap-3 focus:outline-none"
          >
            <div
              className="relative w-24 h-24 rounded-2xl flex items-center justify-center text-2xl font-semibold text-black/80 ring-2 ring-transparent group-hover:ring-white/80 group-focus:ring-white/80 transition-all"
              style={{ backgroundColor: u.avatar_color }}
            >
              {initials(u.name)}
              {u.is_admin && (
                <span className="absolute -bottom-1.5 -right-1.5 bg-zinc-900 rounded-full p-1 ring-2 ring-zinc-950">
                  <ShieldCheck size={14} className="text-amber-400" />
                </span>
              )}
            </div>
            <span className="text-sm text-zinc-400 group-hover:text-zinc-100 transition-colors">{u.name}</span>
          </button>
        ))}

        {users.length === 0 && (
          <div className="text-sm text-zinc-600">Aucun profil. Vérifie que le backend a bien démarré.</div>
        )}
      </div>
    </div>
  )
}
