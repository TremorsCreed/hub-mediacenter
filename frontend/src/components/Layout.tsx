import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Library, History, Film, Radio, Compass, Gamepad2, ChevronLeft, ChevronRight, ShieldCheck, Home, ListVideo } from 'lucide-react'
import { api } from '../api'
import { useUser, initials } from '../UserContext'
import { usePersistedState } from '../usePersistedState'
import NowPlayingBar, { type Dock } from './NowPlayingBar'
import RemoteScreen from './RemoteScreen'

export default function Layout() {
  const [modules, setModules] = useState<{ plex: boolean; iptv: boolean; discover: boolean; launchbox: boolean }>({ plex: false, iptv: false, discover: false, launchbox: false })
  const [collapsed, setCollapsed] = useState(false)
  const [dock, setDock] = usePersistedState<Dock>('hub.nowplaying.dock', 'bottom')
  const location = useLocation()
  const { currentUser, switchProfile } = useUser()
  // Modules « immersifs » qui gèrent leur propre layout interne (sidebars latérales)
  const IMMERSIVE_PATHS = ['/catalog/iptv', '/catalog/plex', '/catalog/launchbox']
  const isImmersive = IMMERSIVE_PATHS.includes(location.pathname) || location.pathname.startsWith('/admin')

  // Cascade : la sidebar système se réduit en entrant dans un module immersif,
  // et se redéveloppe en revenant sur une route classique.
  useEffect(() => {
    setCollapsed(isImmersive)
  }, [isImmersive])

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
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="flex flex-1 min-h-0">
      <aside
        className={`${collapsed ? 'w-14 cursor-pointer' : 'w-52'} shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col transition-[width] duration-200 overflow-hidden`}
        // Vue élargie d'un simple clic : quand la sidebar est réduite, cliquer
        // n'importe où (hors lien/bouton, qui gardent leur action) la développe.
        onClick={e => {
          if (collapsed && !(e.target as HTMLElement).closest('a, button')) setCollapsed(false)
        }}
      >
        {/* Header */}
        <div className="h-[53px] shrink-0 border-b border-zinc-800 flex items-center px-3">
          {collapsed
            ? <Library size={16} strokeWidth={1.8} className="mx-auto text-zinc-500" />
            : <span className="text-sm font-semibold tracking-widest uppercase text-zinc-400 truncate">Hub MediaCenter</span>
          }
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          <NavLink to="/" end title={collapsed ? 'Accueil' : undefined} className={linkClass}>
            <Home size={15} strokeWidth={1.8} />
            {!collapsed && 'Accueil'}
          </NavLink>

          {collapsed
            ? <div className="border-t border-zinc-800/60 mx-2 my-2" />
            : <div className="flex items-center gap-3 px-5 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-600 font-medium">
                <Library size={11} strokeWidth={2} />
                Catalog
              </div>
          }

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

          <NavLink to="/playlists" title={collapsed ? 'Playlists' : undefined} className={linkClass}>
            <ListVideo size={15} strokeWidth={1.8} />
            {!collapsed && 'Playlists'}
          </NavLink>

          <NavLink to="/history" title={collapsed ? 'History' : undefined} className={linkClass}>
            <History size={15} strokeWidth={1.8} />
            {!collapsed && 'History'}
          </NavLink>

          <NavLink to="/admin" title={collapsed ? 'Admin' : undefined} className={linkClass}>
            <ShieldCheck size={15} strokeWidth={1.8} />
            {!collapsed && 'Admin'}
          </NavLink>
        </nav>

        {/* Profil courant + switch */}
        {currentUser && (
          <button
            onClick={switchProfile}
            title={collapsed ? `${currentUser.name} — changer de profil` : 'Changer de profil'}
            className={`shrink-0 border-t border-zinc-800 flex items-center py-2.5 hover:bg-zinc-800/50 transition-colors ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-4'}`}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold text-black/80 shrink-0" style={{ backgroundColor: currentUser.avatar_color }}>
              {initials(currentUser.name)}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0 text-left">
                <div className="text-xs font-medium text-zinc-200 truncate">{currentUser.name}</div>
                <div className="text-[10px] text-zinc-500">Changer de profil</div>
              </div>
            )}
          </button>
        )}

        {/* Footer toggle */}
        <div className="h-[45px] shrink-0 border-t border-zinc-800 flex items-center px-3">
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

      <main className={`flex-1 ${isImmersive ? 'overflow-hidden' : 'overflow-y-auto p-6'}`}>
        <Outlet />
      </main>

      {/* Contrôle média ancré à droite (panneau vertical riche) */}
      {dock === 'right' && <NowPlayingBar dock="right" onToggleDock={() => setDock(d => d === 'right' ? 'bottom' : 'right')} />}
      </div>

      {/* …ou ancré en bas (barre horizontale). Se masque si rien ne joue. */}
      {dock === 'bottom' && <NowPlayingBar dock="bottom" onToggleDock={() => setDock(d => d === 'right' ? 'bottom' : 'right')} />}

      {/* Modale miroir d'écran (ws-scrcpy), ouverte par les boutons « Remote » */}
      <RemoteScreen />
    </div>
  )
}
