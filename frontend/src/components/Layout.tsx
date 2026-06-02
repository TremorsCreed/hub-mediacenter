import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Tv, Library, History, Play, LayoutDashboard, Settings, Film, KeyRound, Radio, FolderOpen, Compass, Gamepad2, ChevronLeft, ChevronRight } from 'lucide-react'
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
  const [modules, setModules] = useState<{ plex: boolean; iptv: boolean; discover: boolean; launchbox: boolean }>({ plex: false, iptv: false, discover: false, launchbox: false })
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar.collapsed') === 'true')
  const location = useLocation()
  const isIptv = location.pathname === '/catalog/iptv'

  // Auto-réduire la sidebar quand on entre dans le module IPTV
  useEffect(() => {
    if (isIptv) setCollapsed(true)
  }, [isIptv])

  // Persistance de l'état collapsed
  useEffect(() => {
    localStorage.setItem('sidebar.collapsed', String(collapsed))
  }, [collapsed])

  const refreshModules = useCallback(() => {
    Promise.all([
      api.plex.status().catch(() => ({ connected: false })),
      api.iptv.credentials().catch(() => []),
      fetch('/api/launchbox/platforms').then(r => r.json()).catch(() => []),
    ]).then(([plex, iptv, lbPlatforms]) => {
      setModules({ plex: plex.connected, iptv: iptv.length > 0, discover: plex.connected, launchbox: lbPlatforms.length > 0 })
    })
  }, [])

  useEffect(() => { refreshModules() }, [location.pathname, refreshModules])
  useEffect(() => {
    const onFocus = () => refreshModules()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshModules])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center py-2.5 text-sm transition-colors ${
      collapsed ? 'justify-center px-0' : 'gap-3 px-5'
    } ${
      isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
    }`

  const subLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center py-1.5 text-xs transition-colors ${
      collapsed ? 'justify-center px-0' : 'gap-2 pl-12 pr-5'
    } ${
      isActive ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40'
    }`

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={`${collapsed ? 'w-14' : 'w-52'} shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col transition-[width] duration-200 overflow-hidden`}>
        {/* Header */}
        <div className="h-[53px] shrink-0 border-b border-zinc-800 flex items-center px-3">
          {collapsed
            ? <Library size={16} strokeWidth={1.8} className="mx-auto text-zinc-500" />
            : <span className="text-sm font-semibold tracking-widest uppercase text-zinc-400 truncate">Hub MediaCenter</span>
          }
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          {topNav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} title={collapsed ? label : undefined} className={linkClass}>
              <Icon size={15} strokeWidth={1.8} />
              {!collapsed && label}
            </NavLink>
          ))}

          {collapsed
            ? <div className="border-t border-zinc-800/60 mx-2 my-2" />
            : <div className="flex items-center gap-3 px-5 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-600 font-medium">
                <Library size={11} strokeWidth={2} />
                Catalog
              </div>
          }

          <NavLink to="/catalog" end title={collapsed ? 'Local' : undefined} className={subLinkClass}>
            <FolderOpen size={collapsed ? 15 : 12} strokeWidth={1.8} />
            {!collapsed && 'Local'}
          </NavLink>
          {modules.discover && (
            <NavLink to="/catalog/discover" title={collapsed ? 'Discover' : undefined} className={subLinkClass}>
              <Compass size={collapsed ? 15 : 12} strokeWidth={1.8} />
              {!collapsed && 'Discover'}
            </NavLink>
          )}
          {modules.iptv && (
            <NavLink to="/catalog/iptv" title={collapsed ? 'IPTV' : undefined} className={subLinkClass}>
              <Radio size={collapsed ? 15 : 12} strokeWidth={1.8} />
              {!collapsed && 'IPTV'}
            </NavLink>
          )}
          {modules.plex && (
            <NavLink to="/catalog/plex" title={collapsed ? 'Plex' : undefined} className={subLinkClass}>
              <Film size={collapsed ? 15 : 12} strokeWidth={1.8} />
              {!collapsed && 'Plex'}
            </NavLink>
          )}
          {modules.launchbox && (
            <NavLink to="/catalog/launchbox" title={collapsed ? 'LaunchBox' : undefined} className={subLinkClass}>
              <Gamepad2 size={collapsed ? 15 : 12} strokeWidth={1.8} />
              {!collapsed && 'LaunchBox'}
            </NavLink>
          )}
          <div className="h-3" />

          {bottomNav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={collapsed ? label : undefined} className={linkClass}>
              <Icon size={15} strokeWidth={1.8} />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        {/* Footer avec bouton toggle */}
        <div className="shrink-0 border-t border-zinc-800 flex items-center px-3 py-3">
          {!collapsed && <span className="text-xs text-zinc-600 mr-auto">v0.1.0</span>}
          <button
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Agrandir la sidebar' : 'Réduire la sidebar'}
            className={`text-zinc-600 hover:text-zinc-300 transition-colors ${collapsed ? 'mx-auto' : ''}`}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </aside>

      <main className={`flex-1 ${isIptv ? 'overflow-hidden' : 'overflow-y-auto p-6'}`}>
        <Outlet />
      </main>
    </div>
  )
}
