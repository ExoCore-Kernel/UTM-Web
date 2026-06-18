const coiHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin"
};

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }
  event.respondWith((async () => {
    const response = await fetch(request);
    if (new URL(request.url).origin !== self.location.origin) {
      return response;
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(coiHeaders)) {
      headers.set(key, value);
    }
    const url = new URL(request.url);
    const noStoreDestinations = new Set(["document", "script", "style", "worker", "serviceworker"]);
    if (noStoreDestinations.has(request.destination) || /\.(?:html|js|css)$/i.test(url.pathname)) {
      headers.set("Cache-Control", "no-store, must-revalidate");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  })());
});
