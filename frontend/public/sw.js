/*
 * Service worker minimal pour Hub MediaCenter.
 *
 * Objectif : rendre l'application installable (PWA) sans cache offline
 * agressif. On garde une strategie reseau d'abord pour ne jamais servir
 * une version perimee du Hub, avec un repli sur le cache uniquement quand
 * le reseau est indisponible.
 *
 * Le hub interroge en permanence le backend (/api) et pilote des appareils
 * en temps reel : mettre en cache ces reponses ferait plus de mal que de
 * bien. On se limite donc au shell de navigation.
 */

const CACHE = 'hub-shell-v1';
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // On ne gere que les GET de meme origine.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // On ne touche jamais a l'API ni au flux de sante : toujours le reseau.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  // Navigations (HTML) : reseau d'abord, repli cache puis index.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
    );
    return;
  }

  // Autres GET (assets) : cache d'abord, sinon reseau (et on garnit le cache).
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
