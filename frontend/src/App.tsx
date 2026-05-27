import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import Catalog from './pages/Catalog'
import PlayPage from './pages/PlayPage'
import History from './pages/History'
import Settings from './pages/Settings'
import Plex from './pages/Plex'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="devices" element={<Devices />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="plex" element={<Plex />} />
        <Route path="play" element={<PlayPage />} />
        <Route path="history" element={<History />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
