import { Routes, Route, Navigate } from 'react-router-dom'
import { useUser } from './UserContext'
import Layout from './components/Layout'
import AdminSection from './components/AdminSection'
import AdminGate from './components/AdminGate'
import ProfileSelect from './pages/ProfileSelect'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import Catalog from './pages/Catalog'
import PlayPage from './pages/PlayPage'
import History from './pages/History'
import Settings from './pages/Settings'
import Plex from './pages/Plex'
import Iptv from './pages/Iptv'
import Discover from './pages/Discover'
import Credentials from './pages/Credentials'
import Launchbox from './pages/Launchbox'
import Profiles from './pages/Profiles'

export default function App() {
  const { currentUser, loading } = useUser()

  if (loading) return null
  if (!currentUser) return <ProfileSelect />

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Espace membre */}
        <Route index element={<Navigate to="/catalog" replace />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="catalog/plex" element={<Plex />} />
        <Route path="catalog/iptv" element={<Iptv />} />
        <Route path="catalog/discover" element={<Discover />} />
        <Route path="catalog/launchbox" element={<Launchbox />} />
        <Route path="history" element={<History />} />
        <Route path="play" element={<PlayPage />} />

        {/* Section Admin (protégée par PIN) */}
        <Route path="admin" element={<AdminGate><AdminSection /></AdminGate>}>
          <Route index element={<Dashboard />} />
          <Route path="profiles" element={<Profiles />} />
          <Route path="devices" element={<Devices />} />
          <Route path="credentials" element={<Credentials />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/catalog" replace />} />
    </Routes>
  )
}
