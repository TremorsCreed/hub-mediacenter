import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Library, History, Film, Radio, Compass, Gamepad2, ChevronLeft, ChevronRight, ShieldCheck, Home, ListVideo, Sparkles, Menu } from 'lucide-react'
import { api } from '../api'
import { useUser, initials } from '../UserContext'
import { usePersistedState } from '../usePersistedState'
import { useIsMobile } from '../useMediaQuery'
import NowPlayingBar, { type Dock } from './NowPlayingBar'
import RemoteScreen from './RemoteScreen'

export default function Layout() {
  const [modules, setModules] = useState<{ plex: boolean; iptv: boolean; discover: boolean; launchbox: boolean }>({ plex: false, iptv: false, discover: false, launchbox: false })
  const [inboxCount, setInboxCount] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [dock, setDock] = usePersistedState<Dock>('hub.nowplaying.dock', 'bottom')
  const location = useLocation()
  const { currentUser, switchProfile } = useUser()
  const isMobile = useIsMobile()
  // Modules « immersifs » qui gèrent leur propre layout interne (sidebars latérales)
  const IMMERSIVE_PATHS = ['/catalog/iptv', '/catalog/plex', '/catalog/launchbox']
  const isImmersive = IMMERSIVE_PATHS.includes(location.pathname) || location.pathname.startsWith('/admin')

  // Sur mobile, la sidebar est un drawer (toujours « étendue » dedans). Le mode
  // réduit (w-14) ne concerne que le desktop.
  const showCollapsed = collapsed && !isMobile

  // Cascade : la sidebar système se réduit en entrant dans un module immersif,
  // et se redéveloppe en revenant sur une route classique.
  useEffect(() => {
    setCollapsed(isImmersive)
  }, [isImmersive])

  // Le drawer mobile se referme à chaque changement de route.
  useEffect(() => { setMobileNavOpen(false) }, [location.pathname])

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

  // Badge Découvertes : nombre d'items 'pending' dans la boîte de réception.
  const refreshInbox = useCallback(() => {
    api.companion.inbox()
      .then(list => setInboxCount(list.filter(i => i.status === 'pending').length))
      .catch(() => { /* route absente / hors-ligne : pas de badge */ })
  }, [])
  useEffect(() => { refreshInbox() }, [location.pathname, refreshInbox])
  useEffect(() => {
    const onChanged = () => refreshInbox()
    window.addEventListener('hub:inbox-changed', onChanged)
    window.addEventListener('focus', onChanged)
    const t = setInterval(refreshInbox, 60000)
    return () => {
      window.removeEventListener('hub:inbox-changed', onChanged)
      window.removeEventListener('focus', onChanged)
      clearInterval(t)
    }
  }, [refreshInbox])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center text-sm transition-colors ${
      showCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-5 py-3 md:py-2.5'
    } ${
      isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
    }`

  const subLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center transition-colors ${
      showCollapsed ? 'justify-center px-0 py-1.5 text-xs' : 'gap-2 pl-12 pr-5 py-2.5 md:py-1.5 text-sm md:text-xs'
    } ${
      isActive ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40'
    }`

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <div className="flex flex-1 min-h-0">
      {/* Scrim du drawer mobile */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden animate-[fadein_150ms_ease-out]"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-hidden shrink-0
          fixed inset-y-0 left-0 z-50 w-64 max-w-[82vw] transition-transform duration-200
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}
          md:static md:z-auto md:translate-x-0 md:max-w-none md:transition-[width] md:duration-200
          ${showCollapsed ? 'md:w-14 md:cursor-pointer' : 'md:w-52'}`}
        // Vue élargie d'un simple clic (desktop) : quand la sidebar est réduite, cliquer
        // n'importe où (hors lien/bouton, qui gardent leur action) la développe.
        onClick={e => {
          if (!isMobile && collapsed && !(e.target as HTMLElement).closest('a, button')) setCollapsed(false)
        }}
      >
        {/* Header */}
        <div className="h-[53px] shrink-0 border-b border-zinc-800 flex items-center px-3">
          {showCollapsed
            ? <Library size={16} strokeWidth={1.8} className="mx-auto text-zinc-500" />
            : <span className="text-sm font-semibold tracking-widest uppercase text-zinc-400 truncate">Hub MediaCenter</span>
          }
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          <NavLink to="/" end title={showCollapsed ? 'Accueil' : undefined} className={linkClass}>
            <Home size={15} strokeWidth={1.8} />
            {!showCollapsed && 'Accueil'}
          </NavLink>

          {showCollapsed
            ? <div className="border-t border-zinc-800/60 mx-2 my-2" />
            : <div className="flex items-center gap-3 px-5 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-600 font-medium">
                <Library size={11} strokeWidth={2} />
                Catalog
              </div>
          }

          {modules.discover && (
            <NavLink to="/catalog/discover" title={showCollapsed ? 'Discover' : undefined} className={subLinkClass}>
              <Compass size={showCollapsed ? 15 : 12} strokeWidth={1.8} />
              {!showCollapsed && 'Discover'}
            </NavLink>
          )}
          {modules.iptv && (
            <NavLink to="/catalog/iptv" title={showCollapsed ? 'IPTV' : undefined} className={subLinkClass}>
              <Radio size={showCollapsed ? 15 : 12} strokeWidth={1.8} />
              {!showCollapsed && 'IPTV'}
            </NavLink>
          )}
          {modules.plex && (
            <NavLink to="/catalog/plex" title={showCollapsed ? 'Plex' : undefined} className={subLinkClass}>
              <Film size={showCollapsed ? 15 : 12} strokeWidth={1.8} />
              {!showCollapsed && 'Plex'}
            </NavLink>
          )}
          {modules.launchbox && (
            <NavLink to="/catalog/launchbox" title={showCollapsed ? 'LaunchBox' : undefined} className={subLinkClass}>
              <Gamepad2 size={showCollapsed ? 15 : 12} strokeWidth={1.8} />
              {!showCollapsed && 'LaunchBox'}
            </NavLink>
          )}

          <div className="h-3" />

          <NavLink to="/playlists" title={showCollapsed ? 'Playlists' : undefined} className={linkClass}>
            <ListVideo size={15} strokeWidth={1.8} />
            {!showCollapsed && 'Playlists'}
          </NavLink>

          <NavLink to="/discoveries" title={showCollapsed ? 'Découvertes' : undefined} className={linkClass}>
            <div className="relative">
              <Sparkles size={15} strokeWidth={1.8} />
              {inboxCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-amber-500 text-black text-[9px] font-bold flex items-center justify-center leading-none">
                  {inboxCount > 99 ? '99+' : inboxCount}
                </span>
              )}
            </div>
            {!showCollapsed && (
              <span className="flex-1 flex items-center justify-between">
                Découvertes
                {inboxCount > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center leading-none">
                    {inboxCount > 99 ? '99+' : inboxCount}
                  </span>
                )}
              </span>
            )}
          </NavLink>

          <NavLink to="/history" title={showCollapsed ? 'History' : undefined} className={linkClass}>
            <History size={15} strokeWidth={1.8} />
            {!showCollapsed && 'History'}
          </NavLink>

          <NavLink to="/admin" title={showCollapsed ? 'Admin' : undefined} className={linkClass}>
            <ShieldCheck size={15} strokeWidth={1.8} />
            {!showCollapsed && 'Admin'}
          </NavLink>
        </nav>

        {/* Profil courant + switch */}
        {currentUser && (
          <button
            onClick={switchProfile}
            title={showCollapsed ? `${currentUser.name} — changer de profil` : 'Changer de profil'}
            className={`shrink-0 border-t border-zinc-800 flex items-center py-2.5 hover:bg-zinc-800/50 transition-colors ${showCollapsed ? 'justify-center px-0' : 'gap-2.5 px-4'}`}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold text-black/80 shrink-0" style={{ backgroundColor: currentUser.avatar_color }}>
              {initials(currentUser.name)}
            </div>
            {!showCollapsed && (
              <div className="flex-1 min-w-0 text-left">
                <div className="text-xs font-medium text-zinc-200 truncate">{currentUser.name}</div>
                <div className="text-[10px] text-zinc-500">Changer de profil</div>
              </div>
            )}
          </button>
        )}

        {/* Footer toggle (réduction = desktop uniquement) */}
        <div className="h-[45px] shrink-0 border-t border-zinc-800 hidden md:flex items-center px-3">
          {!showCollapsed && <span className="text-xs text-zinc-600 mr-auto">v0.1.0</span>}
          <button
            onClick={() => setCollapsed(v => !v)}
            title={showCollapsed ? 'Agrandir la sidebar' : 'Réduire la sidebar'}
            className={`text-zinc-600 hover:text-zinc-300 transition-colors ${showCollapsed ? 'mx-auto' : ''}`}
          >
            {showCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </aside>

      {/* Colonne contenu : barre du haut mobile + zone principale.
          Ancré à droite en fenêtre étroite, on masque complètement cette colonne
          pour que le panneau de contrôle occupe 100 % (sinon un liseré d'accueil
          reste visible et inutilisable). On y revient via le bouton « ancrer en bas ». */}
      <div className={`flex-1 flex-col min-w-0 ${dock === 'right' ? 'hidden md:flex' : 'flex'}`}>
        {/* Barre d'app mobile (hamburger + titre + profil) */}
        <header className="md:hidden h-12 shrink-0 bg-zinc-900 border-b border-zinc-800 flex items-center gap-1 px-1">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Ouvrir le menu"
            className="w-11 h-11 flex items-center justify-center text-zinc-300 hover:text-white shrink-0"
          >
            <Menu size={22} strokeWidth={1.8} />
          </button>
          <span className="text-sm font-semibold tracking-widest uppercase text-zinc-400 truncate">Hub MediaCenter</span>
          <div className="flex-1" />
          {currentUser && (
            <button
              onClick={switchProfile}
              aria-label={`${currentUser.name} — changer de profil`}
              className="w-11 h-11 flex items-center justify-center shrink-0"
            >
              <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-semibold text-black/80" style={{ backgroundColor: currentUser.avatar_color }}>
                {initials(currentUser.name)}
              </span>
            </button>
          )}
        </header>

        <main className={`flex-1 ${isImmersive ? 'overflow-hidden' : 'overflow-y-auto p-4 md:p-6'}`}>
          <Outlet />
        </main>
      </div>

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
