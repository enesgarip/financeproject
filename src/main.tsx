import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { App } from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { ErrorFallback } from './components/ErrorFallback'

const storedTheme = localStorage.getItem('theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.classList.toggle('dark', storedTheme ? storedTheme === 'dark' : prefersDark)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary fallback={<ErrorFallback />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)

// Yakalanmamış hatalar client_errors'a (Sentry'siz izleme). PROD-only: yerelde
// konsol var; kurulum gecikmeli + dinamik importla — entry bütçesine binmez
// (dailyGoalSnapshots dersi). Boundary raporu bundan bağımsız her ortamda çalışır.
if (import.meta.env.PROD) {
  window.setTimeout(() => {
    void import('./lib/errorReport').then((mod) => mod.installClientErrorReporting()).catch(() => undefined)
  }, 3000)
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // `controllerchange` ilk kayıtta da tetiklenir; o an tazelemek yeni ziyaretçiyi
  // sebepsiz reload'a sokar. Kayıttan ÖNCE kontrolcü var mıydı, onu tutuyoruz.
  const hadController = Boolean(navigator.serviceWorker.controller)

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })

  /**
   * Yeni service worker devraldığında AÇIK sayfa hâlâ eski JS/CSS'i çalıştırır.
   * `sw.js` `skipWaiting` + `clients.claim` yapıyor ama bunlar kontrolü devreder,
   * sayfayı tazelemez. iOS'ta ana ekrana eklenmiş uygulama açılışta çoğu zaman
   * eski sayfayı sürdürdüğü için deploy kullanıcıya hiç ulaşmayabiliyordu.
   */
  let reloading = false
  const isEditing = () =>
    Boolean(document.activeElement?.closest('input, textarea, select, [contenteditable="true"]'))

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true

    // Form doldururken tazelemek girdiyi siler. O durumda bekle: sekme arkaya
    // alınıp geri geldiğinde ve odak formdan çıkmışken tazele.
    if (!isEditing()) {
      window.location.reload()
      return
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !isEditing()) window.location.reload()
    })
  })
}
