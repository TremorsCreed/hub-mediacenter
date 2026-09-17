import { Routes, Route, Navigate } from 'react-router-dom'
import { useUser } from './UserContext'
import Layout from './components/Layout'
import AdminSection from './components/AdminSection'
import AdminGate from './components/AdminGate'
import ProfileSelect from './pages/ProfileSelect'
import UserDashboard from './pages/UserDashboard'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import History from './pages/History'
import Settings from './pages/Settings'
import Plex from './pages/Plex'
import Iptv from './pages/Iptv'
import Discover from './pages/Discover'
import Credentials from './pages/Credentials'
import IptvCategories from './pages/IptvCategories'
import Launchbox from './pages/Launchbox'
import Profiles from './pages/Profiles'
import Playlists from './pages/Playlists'
import PlaylistDetail from './pages/PlaylistDetail'
import ImportPlaylist from './pages/ImportPlaylist'
import Inbox from './pages/Inbox'
import AdminLlm from './pages/AdminLlm'
import EmbedRemote from './pages/EmbedRemote'

export default function App() {
  const { currentUser, loading } = useUser()

  // Route d'embed sans auth (integration tierce, ex: carte iframe Home
  // Assistant) : court-circuite le layout et le gate profil.
  const embedMatch = window.location.pathname.match(/^\/embed\/remote\/(.+)$/)
  if (embedMatch) return <EmbedRemote ip={decodeURIComponent(embedMatch[1])} />

  if (loading) return null
  if (!currentUser) return <ProfileSelect />

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Espace membre */}
        <Route index element={<UserDashboard />} />
        <Route path="catalog" element={<Navigate to="/catalog/iptv" replace />} />
        <Route path="catalog/plex" element={<Plex />} />
        <Route path="catalog/iptv" element={<Iptv />} />
        <Route path="catalog/discover" element={<Discover />} />
        <Route path="catalog/launchbox" element={<Launchbox />} />
        <Route path="playlists" element={<Playlists />} />
        <Route path="playlists/import" element={<ImportPlaylist />} />
        <Route path="playlists/:id" element={<PlaylistDetail />} />
        <Route path="discoveries" element={<Inbox />} />
        <Route path="history" element={<History />} />

        {/* Section Admin (protégée par PIN) */}
        <Route path="admin" element={<AdminGate><AdminSection /></AdminGate>}>
          <Route index element={<Dashboard />} />
          <Route path="profiles" element={<Profiles />} />
          <Route path="devices" element={<Devices />} />
          <Route path="credentials" element={<Credentials />} />
          <Route path="iptv-categories" element={<IptvCategories />} />
          <Route path="llm" element={<AdminLlm />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
