import { LogOut } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { BottomNav } from './BottomNav'

const titles: Record<string, string> = {
  '/': 'Finans Özeti',
  '/varliklar': 'Varlıklar',
  '/kartlar': 'Kartlar',
  '/krediler': 'Krediler',
  '/borclar': 'Borç / Alacak',
  '/odemeler': 'Ödemeler',
}

export function Layout() {
  const { pathname } = useLocation()
  const { signOut, user } = useAuth()

  return (
    <div className="min-h-svh bg-[#f7f8f4] text-stone-900">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#f7f8f4]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-stone-950">{titles[pathname] ?? 'Finans'}</h1>
            <p className="truncate text-xs text-stone-500">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-sm"
            aria-label="Çıkış yap"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-28 pt-4">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
