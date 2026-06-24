import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { UserProvider } from './UserContext'
import { FavoritesProvider } from './FavoritesContext'
import { WatchedProvider } from './WatchedContext'
import { CurrentProvider } from './CurrentContext'
import './index.css'

// Enregistrement du service worker (PWA installable). On l'enregistre apres
// le load pour ne pas concurrencer le rendu initial. Sans effet en dev (le
// fichier n'existe qu'apres build, servi depuis public/).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <UserProvider>
        <FavoritesProvider>
          <WatchedProvider>
            <CurrentProvider>
              <App />
            </CurrentProvider>
          </WatchedProvider>
        </FavoritesProvider>
      </UserProvider>
    </BrowserRouter>
  </StrictMode>
)
