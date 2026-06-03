import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, Tv, KeyRound, Settings as SettingsIcon, Lock } from 'lucide-react'
import { useUser } from '../UserContext'

const adminNav = [
  { to: '/admin', label: 'Vue d\'ensemble', icon: LayoutDashboard, end: true },
  { to: '/admin/profiles', label: 'Profils', icon: Users, end: false },
  { to: '/admin/devices', label: 'Devices', icon: Tv, end: false },
  { to: '/admin/credentials', label: 'Credentials', icon: KeyRound, end: false },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

// Layout immersif de la section Admin : sidebar latérale + contenu scrollable.
// La sidebar système (dans Layout) se réduit déjà en icônes sur /admin/*.
export default function AdminSection() {
  const { lockAdmin } = useUser()

  return (
    <div className="flex h-full">
      <aside className="w-52 shrink-0 bg-zinc-950/60 border-r border-zinc-800 flex flex-col">
        <div className="h-[53px] shrink-0 border-b border-zinc-800 flex items-center px-4">
          <span className="text-sm font-semibold text-white">Admin</span>
        </div>
        <nav className="flex-1 py-1 overflow-y-auto">
          {adminNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `w-full flex items-center gap-2.5 px-4 py-3 text-sm transition-colors text-left border-l-2 ${
                  isActive
                    ? 'bg-zinc-800 text-white border-amber-500'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
                }`
              }
            >
              <Icon size={15} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="h-[45px] shrink-0 border-t border-zinc-800 flex items-center px-3">
          <button
            onClick={lockAdmin}
            title="Verrouiller la section Admin"
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-amber-400 transition-colors"
          >
            <Lock size={13} /> Verrouiller
          </button>
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto p-6 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
