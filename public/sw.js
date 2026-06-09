const CACHE_NAME = 'denge-v2'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

function isApiRequest(url) {
  return url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')
}

function isNavigationOrStaticAsset(request, url) {
  return request.mode === 'navigate' || url.origin === self.location.origin
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // Never cache authenticated API calls — always go to network, no fallback.
  if (isApiRequest(url)) return

  if (!isNavigationOrStaticAsset(event.request, url)) return

  const isNavigation = event.request.mode === 'navigate'

  // App shell & static assets: network-first, fall back to cache.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache successful responses, so a deploy that 404s an old chunk
        // (Vercel rewrites it to index.html) never poisons the cache.
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(event.request)
        if (cached) return cached
        // Only navigations fall back to the app shell. Asset requests (hashed
        // JS/CSS) must fail instead of receiving index.html (text/html), so the
        // app's dynamic-import reload can recover from a stale deploy.
        if (isNavigation) return caches.match('/')
        return Response.error()
      }),
  )
})
