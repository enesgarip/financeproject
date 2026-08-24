// Sürüm yükseltmek eski önbelleği düşürür (activate eşleşmeyen key'leri siler).
// v4: /assets/ cache-first'e geçti — eski karışık (network-first) girdiler düşsün.
const CACHE_NAME = 'denge-v4'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon.svg']

// --- Web Push (roadmap Y1) ---------------------------------------------------
// Gönderici edge fonksiyonu { title, body, url, tag } JSON payload yollar.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Denge'
  const options = {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag,
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(targetUrl)
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})

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

function isHashedAsset(url) {
  // Vite çıktısı içerik-adresli: /assets/<ad>-<hash>.<uzantı>. İçerik değişince
  // URL de değişir, bayatlaması imkânsız → cache-first hem güvenli hem en hızlısı.
  return url.pathname.startsWith('/assets/')
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // Never cache authenticated API calls — always go to network, no fallback.
  if (isApiRequest(url)) return

  if (!isNavigationOrStaticAsset(event.request, url)) return

  // Hash'li asset'ler: cache-first. Eski network-first her açılışta değişmemiş
  // chunk'lar için bile ağa çıkıyordu. Hash'li dosyaya index.html fallback'i
  // yine YOK — stale deploy'da dinamik import hatası uygulamanın kendi reload
  // kurtarmasına düşmeli (aşağıdaki network-first yorumuyla aynı kural).
  if (url.origin === self.location.origin && isHashedAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
            }
            return response
          })
          .catch(() => Response.error())
      }),
    )
    return
  }

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
