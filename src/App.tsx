import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Layout } from './components/Layout'

const AssetsPage = lazy(() =>
  import('./pages/AssetsPage').then((module) => ({ default: module.AssetsPage })),
)
const AnalysisPage = lazy(() =>
  import('./pages/AnalysisPage').then((module) => ({ default: module.AnalysisPage })),
)
const CardsPage = lazy(() =>
  import('./pages/CardsPage').then((module) => ({ default: module.CardsPage })),
)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
)
const DebtsPage = lazy(() =>
  import('./pages/DebtsPage').then((module) => ({ default: module.DebtsPage })),
)
const LoansPage = lazy(() =>
  import('./pages/LoansPage').then((module) => ({ default: module.LoansPage })),
)
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })),
)
const MorePage = lazy(() =>
  import('./pages/MorePage').then((module) => ({ default: module.MorePage })),
)
const PaymentsPage = lazy(() =>
  import('./pages/PaymentsPage').then((module) => ({ default: module.PaymentsPage })),
)

function PageFallback() {
  return (
    <div className="mx-auto flex min-h-[45vh] w-full max-w-md items-center justify-center px-6">
      <div className="h-24 w-full animate-pulse rounded-2xl border border-border bg-muted/60 shadow-sm" />
    </div>
  )
}

function routeElement(page: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{page}</Suspense>
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={routeElement(<LoginPage />)} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={routeElement(<DashboardPage />)} />
          <Route path="varliklar" element={routeElement(<AssetsPage />)} />
          <Route path="kartlar" element={routeElement(<CardsPage />)} />
          <Route path="krediler" element={routeElement(<LoansPage />)} />
          <Route path="borclar" element={routeElement(<DebtsPage />)} />
          <Route path="odemeler" element={routeElement(<PaymentsPage />)} />
          <Route path="analiz" element={routeElement(<AnalysisPage />)} />
          <Route path="daha" element={routeElement(<MorePage />)} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
