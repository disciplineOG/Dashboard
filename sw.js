const CACHE = 'dashboard-v15';
// Separate, never-purged cache used as tiny key/value storage. Service workers keep no
// in-memory state between restarts, so config handed over via postMessage() (Firebase
// project + VAPID key) would otherwise be lost by the time a pushsubscriptionchange
// event fires with no page open to ask.
const CONFIG_CACHE = 'dashboard-config-v1';
const CONFIG_KEY = 'https://dashboard-config.local/fb-config';
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
    caches.open(CACHE).then(function(c) {
      // addAll() is all-or-nothing — one flaky cross-origin request (the gstatic
      // CDN scripts) would otherwise fail the ENTIRE install, leaving no service
      // worker ever active and navigator.serviceWorker.ready hanging forever on
      // every future page load (breaking push subscribe with no visible error).
      return Promise.all(ASSETS.map(function(url) {
        return c.add(url).catch(function(err) {
          console.warn('SW precache skipped (non-fatal):', url, err);
        });
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE && k !== CONFIG_CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Firebase Realtime Database / Auth calls carry live, per-request data (auth tokens,
  // fresh reads/writes) — never let the cache answer or store these, or the app could
  // show stale data or silently drop a write.
  var isFirebaseApi = url.indexOf('firebaseio.com') !== -1 ||
    url.indexOf('firebasedatabase.app') !== -1 ||
    url.indexOf('identitytoolkit.googleapis.com') !== -1 ||
    url.indexOf('securetoken.googleapis.com') !== -1;
  if (isFirebaseApi) {
    e.respondWith(fetch(e.request));
    return;
  }
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
  // SET_FB_CONFIG: index.html hands over the Firebase project + VAPID key so this worker
  // can resubscribe on its own if pushsubscriptionchange fires with no tab open.
  if (e.data && e.data.type === 'SET_FB_CONFIG' && e.data.dbUrl && e.data.apiKey) {
    storeFbConfig({ dbUrl: e.data.dbUrl, apiKey: e.data.apiKey, vapidKey: e.data.vapidKey });
  }
});

function storeFbConfig(cfg) {
  return caches.open(CONFIG_CACHE).then(function(c) {
    return c.put(CONFIG_KEY, new Response(JSON.stringify(cfg)));
  });
}

function getStoredFbConfig() {
  return caches.open(CONFIG_CACHE)
    .then(function(c) { return c.match(CONFIG_KEY); })
    .then(function(r) { return r ? r.json() : null; })
    .catch(function() { return null; });
}

function urlB64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Mirrors _simpleHash() in index.html — must stay in sync with it, since it's how both
// sides derive the same push_subscriptions/<id> key from a subscription endpoint.
function simpleHash(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return 'sub_' + Math.abs(h);
}

function signInAnon(apiKey) {
  return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + apiKey, {
    method: 'POST',
    body: JSON.stringify({ returnSecureToken: true })
  }).then(function(r) { return r.json(); }).then(function(auth) { return auth.idToken; });
}

// The browser can invalidate/rotate a push subscription at any time (key rotation,
// expiry) without the page being open. If we don't resubscribe here, the app silently
// stops receiving schedule reminders until the user happens to reopen it.
self.addEventListener('pushsubscriptionchange', function(e) {
  e.waitUntil(
    getStoredFbConfig().then(function(cfg) {
      if (!cfg || !cfg.dbUrl || !cfg.apiKey || !cfg.vapidKey) return;
      return self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(cfg.vapidKey)
      }).then(function(newSub) {
        return signInAnon(cfg.apiKey).then(function(token) {
          var base = cfg.dbUrl.replace(/\/$/, '');
          var payload = newSub.toJSON();
          payload.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          payload.savedAt = Date.now();
          var newId = simpleHash(newSub.endpoint);
          var writes = [
            fetch(base + '/dashboard/data/push_subscriptions/' + newId + '.json?auth=' + token, {
              method: 'PUT',
              body: JSON.stringify(payload)
            })
          ];
          var oldSub = e.oldSubscription;
          if (oldSub && oldSub.endpoint) {
            var oldId = simpleHash(oldSub.endpoint);
            if (oldId !== newId) {
              writes.push(fetch(base + '/dashboard/data/push_subscriptions/' + oldId + '.json?auth=' + token, { method: 'DELETE' }));
            }
          }
          return Promise.all(writes);
        });
      }).catch(function(err) {
        console.error('pushsubscriptionchange resubscribe failed:', err);
      });
    })
  );
});

// ═══ PUSH NOTIFICATIONS (day-type schedule + task due dates) ═══
self.addEventListener('push', function(e) {
  var payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) {}
  var data = payload.data || {};
  var title = payload.title || 'Reminder';
  var isSched = data.type === 'sched';
  var options = {
    body: payload.body || '',
    tag: payload.tag || 'reminder',
    renotify: !!payload.renotify,
    data: data,
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    vibrate: [200, 100, 200]
  };
  // Done/Skip only make sense for a day-type schedule item (they write to `sched`) —
  // a task due-date reminder has nothing equivalent to mark from the notification itself.
  if (isSched) {
    options.actions = [
      { action: 'done', title: '✅ Done' },
      { action: 'skip', title: '⏭️ Skip' }
    ];
  }
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(e) {
  var data = e.notification.data || {};
  e.notification.close();
  if (data.type === 'sched' && (e.action === 'done' || e.action === 'skip')) {
    e.waitUntil(writeSchedState(data, e.action === 'done' ? 1 : 2));
    return;
  }
  if (data.type === 'task') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
        for (var i = 0; i < list.length; i++) {
          if ('focus' in list[i]) return list[i].focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(BASE + '?tab=today');
      })
    );
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      var msg = { type: 'NOTIF_TAP', key: data.key || '', task: data.task || '' };
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) {
          list[i].postMessage(msg);
          return list[i].focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(BASE + '?notif=' + encodeURIComponent(data.key || '') + '&notifTask=' + encodeURIComponent(data.task || ''));
      }
    })
  );
});

function writeSchedState(data, state) {
  if (!data.dbUrl || !data.apiKey || !data.key) return Promise.resolve();
  return signInAnon(data.apiKey).then(function(token) {
    var base = data.dbUrl.replace(/\/$/, '');
    var schedPatch = {};
    schedPatch[data.key] = state;
    return Promise.all([
      fetch(base + '/dashboard/data/sched.json?auth=' + token, { method: 'PATCH', body: JSON.stringify(schedPatch) }),
      fetch(base + '/dashboard/data/_key_ts.json?auth=' + token, { method: 'PATCH', body: JSON.stringify({ sched: Date.now() }) })
    ]);
  }).catch(function() {});
}
