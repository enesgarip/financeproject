import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-sm text-muted-foreground">
        Yükleniyor...
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}
