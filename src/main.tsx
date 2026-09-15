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

void import('./lib/navigationSafety').then(mod => mod.installNavigationSafety())
if (import.meta.env.PROD) void import('./lib/serviceWorkerRegistration').then(mod => mod.registerServiceWorker())
