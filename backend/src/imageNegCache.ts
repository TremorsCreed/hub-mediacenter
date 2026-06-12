// Cache négatif des vignettes IPTV : mémorise les URLs dont l'upstream est mort
// (404, timeout, host injoignable) pour ne pas re-payer le fetch — surtout le
// timeout de 5 s — à chaque rendu. Constat réel : l'hébergeur d'images du
// provider OTT laisse pendre les logos TV (~4-5 s chacun) et le domaine des
// jaquettes VOD renvoie des 40x ; sans mémoire des échecs, chaque affichage
// re-tente tout. En mémoire : se vide au redémarrage, se reconstitue vite.
const dead = new Map<string, number>() // clé (hash md5 de l'url) -> expiry epoch ms

// 6 h : si le provider répare ses images, on les retentera dans la journée.
const TTL_MS = 6 * 60 * 60 * 1000

export function markDead(key: string): void {
  dead.set(key, Date.now() + TTL_MS)
}

export function isDead(key: string): boolean {
  const exp = dead.get(key)
  if (!exp) return false
  if (Date.now() > exp) { dead.delete(key); return false }
  return true
}
