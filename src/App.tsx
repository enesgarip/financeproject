import { Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Analytics } from '@vercel/analytics/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './app/queryClient'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Layout } from './components/Layout'
import { AnalysisHub } from './pages/AnalysisHub'
import { AssetsHub } from './pages/AssetsHub'
import { DataHealthHub } from './pages/DataHealthHub'
import { LiabilitiesHub } from './pages/LiabilitiesHub'
import { PlanningHub } from './pages/PlanningHub'
import { ToastProvider } from './components/ui/toast'
import { lazyWithReload } from './lib/lazyWithReload'

// A failed dynamic import almost always means a new deploy changed the chunk
// hashes while this tab still references the old ones (Vercel then serves
// index.html for the missing /assets/*.js, hence the "not a valid MIME type"
// errors). Reload once to pull the fresh index.html and new chunk URLs; the
// per-tab guard prevents a reload loop if the chunk is genuinely unreachable.
const AssetsPage = lazyWithReload(() =>
  import('./pages/AssetsPage').then((m) => ({ default: m.AssetsPage })),
)
const GoldPage = lazyWithReload(() =>
  import('./pages/GoldPage').then((m) => ({ default: m.GoldPage })),
)
const SalaryPage = lazyWithReload(() =>
  import('./pages/SalaryPage').then((m) => ({ default: m.SalaryPage })),
)
const AnalysisPage = lazyWithReload(() =>
  import('./pages/AnalysisPage').then((m) => ({ default: m.AnalysisPage })),
)
const AnalysisDetailPage = lazyWithReload(() =>
  import('./pages/AnalysisDetailPage').then((m) => ({ default: m.AnalysisDetailPage })),
)
const AssistantPage = lazyWithReload(() =>
  import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })),
)
const CarsPage = lazyWithReload(() =>
  import('./pages/CarsPage').then((m) => ({ default: m.CarsPage })),
)
const LiabilitiesCardsPage = lazyWithReload(() =>
  import('./pages/LiabilitiesCardsPage').then((m) => ({ default: m.LiabilitiesCardsPage })),
)
const CardsPage = lazyWithReload(() =>
  import('./pages/CardsPage').then((m) => ({ default: m.CardsPage })),
)
const DashboardPage = lazyWithReload(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const DataHealthPage = lazyWithReload(() =>
  import('./pages/DataHealthPage').then((m) => ({ default: m.DataHealthPage })),
)
const DataHealthOperationsPage = lazyWithReload(() =>
  import('./pages/DataHealthOperationsPage').then((m) => ({ default: m.DataHealthOperationsPage })),
)
const DebtsPage = lazyWithReload(() =>
  import('./pages/DebtsPage').then((m) => ({ default: m.DebtsPage })),
)
const LoansPage = lazyWithReload(() =>
  import('./pages/LoansPage').then((m) => ({ default: m.LoansPage })),
)
const LoginPage = lazyWithReload(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const PaymentsPage = lazyWithReload(() =>
  import('./pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage })),
)
const PlanningPage = lazyWithReload(() =>
  import('./pages/PlanningPage').then((m) => ({ default: m.PlanningPage })),
)
const WishlistPage = lazyWithReload(() =>
  import('./pages/WishlistPage').then((m) => ({ default: m.WishlistPage })),
)
const PurchaseDecisionPage = lazyWithReload(() =>
  import('./pages/PurchaseDecisionPage').then((m) => ({ default: m.PurchaseDecisionPage })),
)
const ExpenseContextsPage = lazyWithReload(() =>
  import('./pages/ExpenseContextsPage').then((m) => ({ default: m.ExpenseContextsPage })),
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
        {/* Dolgu belirgin (muted/70): açık temada muted/40 neredeyse görünmez olup
            geçiş boş beyaz bir flash gibi okunuyordu — skeleton "yükleniyor" desin. */}
        <div className="h-40 w-full animate-pulse rounded-2xl border border-line-strong bg-page" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-line-strong bg-page" />
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

        {/* Varlıklar hub: holdings + salary + gold + cars (araç = sahip olunan bağlam) */}
        <Route path="varliklar" element={<AssetsHub />}>
          <Route index element={routeElement(<AssetsPage />, 'varliklar')} />
          <Route path="maas" element={routeElement(<SalaryPage />, 'varliklar-maas')} />
          <Route path="altin" element={routeElement(<GoldPage />, 'varliklar-altin')} />
          <Route path="araclar" element={routeElement(<CarsPage />, 'varliklar-araclar')} />
        </Route>

        {/* Borçlar hub: loans + personal debts + credit-card debt */}
        <Route path="borclar" element={<LiabilitiesHub />}>
          <Route index element={<Navigate to="/borclar/krediler" replace />} />
          <Route path="krediler" element={routeElement(<LoansPage />, 'borclar-krediler')} />
          <Route path="kisiler" element={routeElement(<DebtsPage />, 'borclar-kisiler')} />
          <Route path="kartlar" element={routeElement(<LiabilitiesCardsPage />, 'borclar-kartlar')} />
        </Route>

        <Route path="odemeler" element={<PlanningHub />}>
          <Route index element={routeElement(<PaymentsPage />, 'odemeler')} />
          <Route path="hedefler" element={routeElement(<PlanningPage />, 'odemeler-hedefler')} />
          <Route path="alsam-mi" element={routeElement(<PurchaseDecisionPage />, 'odemeler-alsam-mi')} />
          <Route path="liste" element={routeElement(<WishlistPage />, 'odemeler-liste')} />
          <Route path="baglamlar" element={routeElement(<ExpenseContextsPage />, 'odemeler-baglamlar')} />
        </Route>
        {/* Legacy redirect: purchase decision moved from /alsam-mi into the Plan hub. */}
        <Route path="alsam-mi" element={<Navigate to="/odemeler/alsam-mi" replace />} />
        <Route path="analiz" element={<AnalysisHub />}>
          <Route index element={routeElement(<AnalysisPage />, 'analiz')} />
          <Route path="detay" element={routeElement(<AnalysisDetailPage />, 'analiz-detay')} />
          <Route path="asistan" element={routeElement(<AssistantPage />, 'analiz-asistan')} />
          {/* Legacy redirect: cars moved from Analiz to the Varlıklar hub. */}
          <Route path="araclar" element={<Navigate to="/varliklar/araclar" replace />} />
          <Route path="trendler" element={<Navigate to="/analiz" replace />} />
          <Route path="servet" element={<Navigate to="/analiz/detay" replace />} />
          <Route path="kayitlar" element={<Navigate to="/analiz/detay" replace />} />
        </Route>

        <Route path="veri-sagligi" element={<DataHealthHub />}>
          <Route index element={routeElement(<DataHealthPage />, 'veri-sagligi')} />
          <Route path="islemler" element={routeElement(<DataHealthOperationsPage />, 'veri-sagligi-islemler')} />
        </Route>

        {/* Legacy redirect: loans moved from /krediler to /borclar/krediler. */}
        <Route path="krediler" element={<Navigate to="/borclar/krediler" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <ThemeBoot />
          <AnimatedRoutes />
          <Analytics />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
