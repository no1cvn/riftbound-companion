// sw.js — Riftbound Companion service worker
//
// Caches the APP SHELL ONLY (HTML/CSS/JS/icons/manifest). Card data, card
// images, and price data are NEVER cached here — they are always fetched
// live from the data providers at runtime (guardrail #1 in CLAUDE.md: no
// bundled/redistributed Riot artwork).

const CACHE_VERSION = "rbc-shell-v2";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/config.js",
  "./js/api.js",
  "./js/store.js",
  "./js/parser.js",
  "./js/scan.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isShellRequest(url) {
  // Only intercept same-origin GET requests for the app shell. Anything
  // hitting riftscribe.gg, rapidapi.com, tcggo CDN images, etc. must always
  // go to the network untouched.
  return url.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isShellRequest(url)) return; // let card/price/image requests pass through live

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
