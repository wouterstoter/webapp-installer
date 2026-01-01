const CACHE = 'cache-v2026-01-01';

const CACHE_URLS = [
	'index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CACHE_URLS))
      .then(self.skipWaiting())
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim()); // Become available to all pages
});

self.addEventListener('message', e => {
  // Only accept messages from within the scope
  if (!e.source.url.startsWith(self.registration.scope)) return
  // Only accpet messages from the top level, so apps cannot install/uninstall things themselves
  if (e.source.url.slice(self.registration.scope.length).split("/").length > 1) return
  
  console.log(e)
  
  if (e.data.action == "add") {
    caches.delete(e.data.app)
    .then(() => caches.open(e.data.app))
    .then(cache => {
      for (var file in e.data.data) {
        if (file.endsWith("/")) {
          // Redirect to the index.html for directories
          cache.put(new Request(e.data.app + "/" + file), Response.redirect(e.data.app + "/" + file + "index.html",302));
        } else {
          cache.put(new Request(e.data.app + "/" + file), new Response(e.data.data[file]));
        }
      }
    });
  }
});

self.addEventListener('fetch', event => {
  console.log(event);
  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request, {ignoreSearch:true}).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
      })
    );
  }
});