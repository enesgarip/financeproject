import { LogOut, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { BottomNav } from './BottomNav'
import { QuickActions } from './QuickActions'

const titles: Record<string, string> = {
  '/': 'Finans Özeti',
  '/varliklar': 'Varlıklar',
  '/kartlar': 'Kartlar',
  '/krediler': 'Krediler',
  '/borclar': 'Borç / Alacak',
  '/odemeler': 'Ödemeler',
  '/analiz': 'Analiz',
  '/veri-sagligi': 'Veri Sağlığı',
  '/daha': 'Daha',
}

export function Layout() {
  const { pathname } = useLocation()
  const { signOut, user } = useAuth()
  const contentWidthClass = pathname === '/' || pathname === '/analiz' || pathname === '/veri-sagligi' ? 'max-w-5xl' : 'max-w-3xl'
  const [isDark, setIsDark] = useState(() => {
    const storedTheme = localStorage.getItem('theme')
    return storedTheme ? storedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-xl">
        <div className={`mx-auto flex ${contentWidthClass} items-center justify-between gap-3`}>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight text-stone-950 dark:text-stone-50">{titles[pathname] ?? 'Finans'}</h1>
            <p className="truncate text-xs text-stone-500 dark:text-stone-400 max-[360px]:hidden">{user?.email}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setIsDark((current) => !current)}
              className="grid size-10 place-items-center rounded-lg border border-border/80 bg-card text-muted-foreground shadow-sm transition hover:text-foreground"
              aria-label={isDark ? 'Gündüz temasına geç' : 'Gece temasına geç'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="grid size-10 place-items-center rounded-lg border border-border/80 bg-card text-muted-foreground shadow-sm transition hover:text-foreground"
              aria-label="Çıkış yap"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <main className={`mx-auto w-full ${contentWidthClass} flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+11rem)] pt-5`}>
        <Outlet />
      </main>
      <QuickActions />
      <BottomNav />
    </div>
  )
}
