const CACHE = 'dashboard-v6';
// Derive base path dynamically so this SW works at any deployment path (not just /Dashboard/)
const BASE = new URL('./', self.location.href).pathname;
const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Stale-while-revalidate for HTML: return cached shell immediately for instant loads,
  // then fetch and update the cache in the background so the next load gets fresh content.
  var isNav = e.request.mode === 'navigate' || url.endsWith('index.html') || url.endsWith(BASE) || url.endsWith(BASE.replace(/\/$/, ''));
  if (isNav) {
    e.respondWith(
      caches.open(CACHE).then(function(c) {
        return c.match(e.request).then(function(cached) {
          var networkFetch = fetch(e.request).then(function(res) {
            c.put(e.request, res.clone());
            return res;
          }).catch(function() {
            return cached || c.match(BASE + 'index.html');
          });
          // Return cached response immediately if available, otherwise wait for network
          return cached || networkFetch;
        });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function(r) { return r || fetch(e.request); })
  );
});

self.addEventListener('message', function(e) {
  // CLEAR_AUTH: remove cached entries that may contain stale auth state
  if (e.data && e.data.type === 'CLEAR_AUTH') {
    caches.open(CACHE).then(function(c) {
      c.keys().then(function(keys) {
        keys.forEach(function(req) {
          if (req.url.indexOf('#') !== -1) c.delete(req);
        });
      });
    });
  }
});
