// GigHelper service worker
// Purpose: cache the app shell so it works offline and qualifies as an installable PWA.
// This app stores all user data in localStorage on-device — this worker only caches
// the static files needed to load the app itself, never any user data.

const CACHE_NAME = 'route-ledger-v3';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './icon-explainer.png',
  './privacy-policy.html',
  './terms-of-service.html'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(
        names.filter(function(name){ return name !== CACHE_NAME; })
             .map(function(name){ return caches.delete(name); })
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

// Focus/open the app when a maintenance notification is tapped.
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for(var i=0;i<clientList.length;i++){
        var client = clientList[i];
        if('focus' in client) return client.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

// Navigation requests (the app actually opening) get network-first with a
// cache fallback that ignores query strings. Launches from outside the app
// itself — a Google Search "install" prompt, an Assistant deep link, a
// share/redirect link — commonly tack a query string (?utm_source=..., a
// referrer param, etc.) onto the start URL. The old handler matched the
// cache on the exact URL, so those requests missed the cache entirely; if
// the network call then failed or was slow, there was no fallback and the
// app just failed to open. ignoreSearch fixes the match, and trying the
// network first means the user still gets a fresh copy when online.
self.addEventListener('fetch', function(event){
  if(event.request.method !== 'GET') return;

  if(event.request.mode === 'navigate'){
    event.respondWith(
      fetch(event.request).then(function(response){
        if(response && response.status === 200){
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, responseClone); });
        }
        return response;
      }).catch(function(){
        return caches.match(event.request, { ignoreSearch: true }).then(function(cached){
          return cached || caches.match('./index.html', { ignoreSearch: true });
        });
      })
    );
    return;
  }

  // Cache-first for app shell assets; network-first fallback for anything
  // else (e.g. the Google Fonts stylesheet), falling back to cache if offline.
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function(cached){
      if(cached) return cached;
      return fetch(event.request).then(function(response){
        if(response && response.status === 200){
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(function(){
        return cached;
      });
    })
  );
});
