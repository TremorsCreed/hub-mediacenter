import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Node fournit `process` au moment du build ; pas de @types/node côté front, on
// déclare donc juste ce dont on a besoin pour satisfaire tsc.
declare const process: { env: Record<string, string | undefined> }

export default defineConfig({
  plugins: [react()],
  // Identifiant de build visible dans l'UI (footer sidebar) : permet de savoir d'un
  // coup d'œil quelle version est réellement chargée dans le navigateur (utile pour
  // confirmer qu'un déploiement est bien arrivé malgré les caches).
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8020'
    }
  }
})
