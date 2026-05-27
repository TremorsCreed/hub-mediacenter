import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Tv, Library, History, Play, LayoutDashboard, Settings, Film, KeyRound, Radio, FolderOpen, Compass } from 'lucide-react'
import { api } from '../api'

const topNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/devices', label: 'Devices', icon: Tv },
  { to: '/credentials', label: 'Credentials', icon: KeyRound },
]

const bottomNav = [
  { to: '/play', label: 'Play', icon: Play },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  const [modules, setModules] = useState<{ plex: boolean; iptv: boolean; discover: boolean }>({ plex: false, iptv: false, discover: false })
  const location = useLocation()

  const refreshModules = useCallback(() => {
    Promise.all([
      api.plex.status().catch(() => ({ connected: false })),
      api.iptv.credentials().catch(() => []),
    ]).then(([plex, iptv]) => {
      setModules({ plex: plex.connected, iptv: iptv.length > 0, discover: plex.connected })
    })
  }, [])

  // Refresh quand on change de route et quand la fenêtre reprend le focus
  useEffect(() => { refreshModules() }, [location.pathname, refreshModules])
  useEffect(() => {
    const onFocus = () => refreshModules()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshModules])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
      isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
    }`

  const subLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 pl-12 pr-5 py-1.5 text-xs transition-colors ${
      isActive ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40'
    }`

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-52 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="text-sm font-semibold tracking-widest uppercase text-zinc-400">Hub MediaCenter</span>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {topNav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={linkClass}>
              <Icon size={15} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}

          {/* Catalog group avec sous-modules */}
          <div className="flex items-center gap-3 px-5 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-600 font-medium">
            <Library size={11} strokeWidth={2} />
            Catalog
          </div>
          <NavLink to="/catalog" end className={subLinkClass}>
            <FolderOpen size={12} strokeWidth={1.8} />
            Local
          </NavLink>
          {modules.plex && (
            <NavLink to="/catalog/plex" className={subLinkClass}>
              <Film size={12} strokeWidth={1.8} />
              Plex
            </NavLink>
          )}
          {modules.iptv && (
            <NavLink to="/catalog/iptv" className={subLinkClass}>
              <Radio size={12} strokeWidth={1.8} />
              IPTV
            </NavLink>
          )}
          {modules.discover && (
            <NavLink to="/catalog/discover" className={subLinkClass}>
              <Compass size={12} strokeWidth={1.8} />
              Discover
            </NavLink>
          )}
          <div className="h-3" />

          {bottomNav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={linkClass}>
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
