// network-first for the app's own files, so a new deploy is picked up on the next visit
// even without a cache-name bump; the cache is the offline fallback.
const CACHE = "screenscore-v33";
const SHELL = ["./", "./index.html", "./styles.css", "./manifest.webmanifest", "./cinema-icon-180.png", "./cinema-icon-192.png", "./cinema-icon-512.png", "./favicon.png", "./core.js", "./details.js", "./discover.js", "./imdbData.js", "./importer.js", "./main.js", "./ratings.js", "./render.js", "./router.js", "./services.js", "./settings.js", "./sync.js", "./tmdb.js", "./analysis.js", "./common.js", "./discovery.js", "./personal.js", "./watchlist.js"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && !/^\/(tmdb\/|sync)/.test(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match("./index.html"))),
    );
    return;
  }
});
