// Each build registers a distinct worker URL. A matching cache name lets the new install stage
// its full shell first, then activation removes prior revisions and their obsolete hashed bundles.
const BUILD_REVISION = new URL(self.location.href).searchParams.get("revision") || "development";
const CACHE_NAME = `aedjaeger-shell-${BUILD_REVISION}`;
const APP_SHELL = ["/", "/manifest.webmanifest", "/aed-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch("/precache-manifest.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("The app asset manifest could not be loaded.");
        return response.json();
      })
      .then((assets) => caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL, ...assets]))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // This origin can host unrelated apps, so only remove caches that belong to AEDjaeger.
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("aedjaeger-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Fotos, API calls and all cross-origin traffic must never enter the offline cache.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.open(CACHE_NAME).then((cache) => cache.match("/", { ignoreVary: true }))),
    );
    return;
  }

  event.respondWith(
    // Static build assets are public and identical for all visitors, so an irrelevant Vary header
    // from the preview host must not prevent this app's own cache from serving the exact asset URL.
    caches.open(CACHE_NAME).then((cache) => cache.match(request, { ignoreVary: true }).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        event.waitUntil(cache.put(request, copy));
      }
      return response;
    }))),
  );
});
