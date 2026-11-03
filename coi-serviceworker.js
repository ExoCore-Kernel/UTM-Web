const coiHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin"
};
const cachePrefix = `utm-web-${new URL(self.registration.scope).pathname}-`;
const shellCache = `${cachePrefix}v64-20261103-ui-disks`;

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== shellCache).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }
  event.respondWith((async () => {
    let response;
    try {
      response = await fetch(request);
      const url = new URL(request.url);
      const scope = new URL(self.registration.scope).pathname;
      if (request.method === "GET" && response.status === 200 && url.origin === self.location.origin &&
          url.pathname.startsWith(scope) && !url.pathname.includes("/tests/") && !url.pathname.endsWith("/utm-local-status.json")) {
        const cache = await caches.open(shellCache);
        await cache.put(request, response.clone()).catch(() => {});
      }
    } catch (error) {
      response = await (await caches.open(shellCache)).match(request);
      if (!response) throw error;
    }
    if (response.status === 0) return response;
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
