// Verrou de concurrence par provider IPTV (Xtream).
//
// Ces abonnements limitent le nombre de connexions simultanées (souvent 1 ou 2).
// On n'autorise donc qu'UN seul appel réseau à la fois vers un même serveur, TOUS
// chemins confondus : cache de listes/catégories, get_vod_info, get_series_info,
// EPG (get_simple_data_table), résolution d'extension au lancement, etc.
//
// Sans ce verrou, plusieurs requêtes partent en parallèle (préchargement, warmer,
// ouverture de fiche, guide EPG, lecture en cours) → 403 en rafale → risque de
// bannissement. La clé est le host du serveur (normalisé), donc deux providers
// différents restent parallèles entre eux.

const locks = new Map<string, Promise<unknown>>()

function normKey(serverOrUrl: string): string {
  return String(serverOrUrl ?? '').replace(/\/+$/, '').trim().toLowerCase()
}

export function withProviderLock<T>(serverOrUrl: string, fn: () => Promise<T>): Promise<T> {
  const k = normKey(serverOrUrl)
  const prev = locks.get(k) ?? Promise.resolve()
  const run = prev.then(fn, fn)  // s'exécute après le précédent (succès comme échec)
  locks.set(k, run.then(() => {}, () => {}))
  return run
}
