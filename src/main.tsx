import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { App } from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { ErrorFallback } from './components/ErrorFallback'
import { installNavigationSafety } from './lib/navigationSafety'

// Üç saniyelik kör pencere yok; ağır taşıyıcı yine ayrı chunk'ta kalır.
if (import.meta.env.PROD) {
  void import('./lib/errorReport').then((mod) => mod.installClientErrorReporting()).catch(() => undefined)
}

const storedTheme = localStorage.getItem('theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.classList.toggle('dark', storedTheme ? storedTheme === 'dark' : prefersDark)

// Popstate koruması router'dan önce kurulmalı; aksi halde router alanları
// unmount eder, kirli alan temizliği onay sorulmadan girişleri kaybettirir.
installNavigationSafety()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary fallback={<ErrorFallback />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)

if (import.meta.env.PROD) void import('./lib/serviceWorkerRegistration').then(mod => mod.registerServiceWorker())
