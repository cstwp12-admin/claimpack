/* ClaimPack service worker: the app shell works offline.
   index.html, app.js and version.json are fetched from the network first so an update shows at once;
   everything else (libraries, fonts) is served from the cache. */
const CACHE = "claimpack-v0.5.0.1";
const FILES = [
  "./",
  "index.html",
  "app.js",
  "scanner.js",
  "manifest.webmanifest",
  "icon.svg",
  "lib/jspdf.umd.min.js",
  "lib/pdf-lib.min.js",
  "lib/pdfjs.min.js",
  "lib/pdfjs.worker.min.js",
  "lib/qrcode.min.js",
  "lib/tesseract/tesseract.min.js",
  "lib/tesseract/worker.min.js",
  "lib/tesseract/tesseract-core-simd-lstm.wasm.js",
  "lib/tesseract/tesseract-core-lstm.wasm.js",
  "lib/tesseract/lang/eng.traineddata.gz",
  "fonts/adventor-r.ttf",
  "fonts/adventor-b.ttf",
  "fonts/adventor-i.ttf",
  "fonts/pagella-r.ttf",
  "fonts/pagella-b.ttf",
  "fonts/pagella-i.ttf"
];
const NETWORK_FIRST = /(\/|index\.html|app\.js|scanner\.js|version\.json)$/;
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (NETWORK_FIRST.test(url.pathname)) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
      return response;
    }).catch(() => caches.match(event.request, {ignoreSearch: true})));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  })));
});
