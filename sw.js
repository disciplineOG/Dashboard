const CACHE = 'dashboard-v7';
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

// ═══ SCHEDULE PUSH NOTIFICATIONS ═══
self.addEventListener('push', function(e) {
  var payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) {}
  var title = payload.title || 'Schedule Reminder';
  var options = {
    body: payload.body || '',
    tag: payload.tag || 'sched-reminder',
    data: payload.data || {},
    icon: BASE + 'icon-192.png',
    actions: [
      { action: 'done', title: '✅ Done' },
      { action: 'skip', title: '⏭️ Skip' }
    ]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(e) {
  var data = e.notification.data || {};
  e.notification.close();
  if (e.action === 'done' || e.action === 'skip') {
    e.waitUntil(writeSchedState(data, e.action === 'done' ? 1 : 2));
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(BASE);
    })
  );
});

function writeSchedState(data, state) {
  if (!data.dbUrl || !data.apiKey || !data.key) return Promise.resolve();
  return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + data.apiKey, {
    method: 'POST',
    body: JSON.stringify({ returnSecureToken: true })
  }).then(function(r) { return r.json(); }).then(function(auth) {
    var token = auth.idToken;
    var base = data.dbUrl.replace(/\/$/, '');
    var schedPatch = {};
    schedPatch[data.key] = state;
    return Promise.all([
      fetch(base + '/dashboard/data/sched.json?auth=' + token, { method: 'PATCH', body: JSON.stringify(schedPatch) }),
      fetch(base + '/dashboard/data/_key_ts.json?auth=' + token, { method: 'PATCH', body: JSON.stringify({ sched: Date.now() }) })
    ]);
  }).catch(function() {});
}
