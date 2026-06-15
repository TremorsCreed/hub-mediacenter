import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { UserProvider } from './UserContext'
import { FavoritesProvider } from './FavoritesContext'
import { WatchedProvider } from './WatchedContext'
import { CurrentProvider } from './CurrentContext'
import './index.css'

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
