/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Tokens sémantiques mappés sur la palette actuelle (zinc/amber).
      // Purement additif : les classes zinc-*/amber-* existantes restent valides.
      // Objectif : pouvoir écrire bg-surface, text-muted, ring-accent, etc.
      // et n'avoir qu'un seul endroit à changer pour un futur thème.
      colors: {
        base: '#09090b',          // zinc-950, fond global
        surface: '#18181b',       // zinc-900, cartes / barres
        'surface-2': '#27272a',   // zinc-800, survol / élément surélevé
        border: '#27272a',        // zinc-800, bordures et séparateurs
        muted: '#a1a1aa',         // zinc-400, texte secondaire lisible (WCAG AA)
        accent: '#f59e0b',        // amber-500, accent unique de l'app
        'accent-hover': '#fbbf24',// amber-400
        danger: '#dc2626',        // red-600
        success: '#16a34a',       // green-600
      },
    },
  },
  plugins: [],
}
