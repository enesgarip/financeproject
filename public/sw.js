const CACHE_NAME = 'kisisel-finans-v2'
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

  // App shell & static assets: network-first, fall back to cache.
  if (isNavigationOrStaticAsset(event.request, url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
    )
  }
})
