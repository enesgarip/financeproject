import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Layout } from './components/Layout'
import { AssetsHub } from './pages/AssetsHub'
import { LiabilitiesHub } from './pages/LiabilitiesHub'
import { ToastProvider } from './components/ui/toast'

const AssetsPage = lazy(() =>
  import('./pages/AssetsPage').then((m) => ({ default: m.AssetsPage })),
)
const GoldPage = lazy(() =>
  import('./pages/GoldPage').then((m) => ({ default: m.GoldPage })),
)
const SalaryPage = lazy(() =>
  import('./pages/SalaryPage').then((m) => ({ default: m.SalaryPage })),
)
const AnalysisPage = lazy(() =>
  import('./pages/AnalysisPage').then((m) => ({ default: m.AnalysisPage })),
)
const CardsPage = lazy(() =>
  import('./pages/CardsPage').then((m) => ({ default: m.CardsPage })),
)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const DataHealthPage = lazy(() =>
  import('./pages/DataHealthPage').then((m) => ({ default: m.DataHealthPage })),
)
const DebtsPage = lazy(() =>
  import('./pages/DebtsPage').then((m) => ({ default: m.DebtsPage })),
)
const LoansPage = lazy(() =>
  import('./pages/LoansPage').then((m) => ({ default: m.LoansPage })),
)
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const PaymentsPage = lazy(() =>
  import('./pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage })),
)

function PageTransition({ children }: { children: ReactNode }) {
  return (
    <div className="page-route-transition w-full">
      {children}
    </div>
  )
}

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-start justify-center pt-8">
      <div className="flex flex-col gap-4 w-full max-w-2xl">
        <div className="h-40 w-full animate-pulse rounded-2xl border border-border bg-muted/40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40" />
          ))}
        </div>
      </div>
    </div>
  )
}

function routeElement(page: ReactNode, key: string) {
  return (
    <Suspense fallback={<PageFallback />}>
      <PageTransition key={key}>{page}</PageTransition>
    </Suspense>
  )
}

function ThemeBoot() {
  useEffect(() => {
    const storedTheme = localStorage.getItem('theme')
    const isDark = storedTheme
      ? storedTheme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', isDark)
  }, [])
  return null
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <Routes location={location} key={location.pathname}>
      <Route path="/login" element={routeElement(<LoginPage />, 'login')} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={routeElement(<DashboardPage />, '/')} />
        <Route path="kartlar" element={routeElement(<CardsPage />, 'kartlar')} />

        {/* Varlıklar hub: holdings + salary */}
        <Route path="varliklar" element={<AssetsHub />}>
          <Route index element={routeElement(<AssetsPage />, 'varliklar')} />
          <Route path="maas" element={routeElement(<SalaryPage />, 'varliklar-maas')} />
          <Route path="altin" element={routeElement(<GoldPage />, 'varliklar-altin')} />
        </Route>

        {/* Borçlar hub: loans + personal debts */}
        <Route path="borclar" element={<LiabilitiesHub />}>
          <Route index element={<Navigate to="/borclar/krediler" replace />} />
          <Route path="krediler" element={routeElement(<LoansPage />, 'borclar-krediler')} />
          <Route path="kisiler" element={routeElement(<DebtsPage />, 'borclar-kisiler')} />
        </Route>

        <Route path="odemeler" element={routeElement(<PaymentsPage />, 'odemeler')} />
        <Route path="analiz" element={routeElement(<AnalysisPage />, 'analiz')} />
        <Route path="veri-sagligi" element={routeElement(<DataHealthPage />, 'veri-sagligi')} />

        {/* Legacy redirects (bookmarks / PWA shortcuts) */}
        <Route path="krediler" element={<Navigate to="/borclar/krediler" replace />} />
        <Route path="daha" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ThemeBoot />
        <AnimatedRoutes />
      </ToastProvider>
    </AuthProvider>
  )
}
