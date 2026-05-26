import { NavLink, Outlet } from 'react-router-dom'
import { Tv, Library, History, Play, LayoutDashboard } from 'lucide-react'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/devices', label: 'Devices', icon: Tv },
  { to: '/catalog', label: 'Catalog', icon: Library },
  { to: '/play', label: 'Play', icon: Play },
  { to: '/history', label: 'History', icon: History }
]

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-52 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="text-sm font-semibold tracking-widest uppercase text-zinc-400">Hub MediaCenter</span>
        </div>
        <nav className="flex-1 py-3">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`
              }
            >
              <Icon size={15} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-600">v0.1.0</div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
