import { CalendarDays, LogOut, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { cn } from '../lib/utils'
import { BottomNav } from './BottomNav'
import { primaryNavItems } from './navigation'
import { QuickActions } from './QuickActions'

const titles: Record<string, string> = {
  '/': 'Finans Özeti',
  '/varliklar': 'Varlıklar',
  '/kartlar': 'Hesaplar ve Kartlar',
  '/krediler': 'Krediler',
  '/borclar': 'Kişiler',
  '/odemeler': 'Planlı Ödemeler',
  '/analiz': 'Raporlar',
  '/veri-sagligi': 'Veri Kontrolü',
  '/daha': 'Diğer',
}

const widePaths = new Set(['/', '/analiz', '/kartlar', '/krediler', '/veri-sagligi'])
const mediumPaths = new Set(['/varliklar', '/borclar', '/odemeler'])

function getContentWidthClass(pathname: string) {
  if (widePaths.has(pathname)) return 'max-w-7xl'
  if (mediumPaths.has(pathname)) return 'max-w-5xl'
  return 'max-w-4xl'
}

function currentDateLabel() {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())
}

export function Layout() {
  const { pathname } = useLocation()
  const { signOut, user } = useAuth()
  const contentWidthClass = getContentWidthClass(pathname)
  const [isDark, setIsDark] = useState(() => {
    const storedTheme = localStorage.getItem('theme')
    return storedTheme ? storedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-border/80 bg-card/88 p-4 shadow-[18px_0_54px_rgba(16,24,40,0.08)] backdrop-blur-xl dark:shadow-black/35 lg:flex">
        <div className="finance-command-surface mb-5 flex items-center gap-3 rounded-lg p-3">
          <div className="grid size-11 place-items-center rounded-lg bg-primary text-lg font-black text-primary-foreground shadow-sm shadow-primary/25">
            ₺
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-black text-foreground">FinanceProject</p>
            <p className="truncate text-xs font-semibold text-muted-foreground">Kişisel finans kontrol merkezi</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1.5">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => {
                const itemIsActive = isActive || ('activePaths' in item && (item.activePaths as readonly string[]).includes(pathname))
                return cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-black transition',
                  itemIsActive
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                    : 'text-muted-foreground hover:bg-muted/75 hover:text-foreground',
                )
              }}
            >
              <item.icon size={18} strokeWidth={2.2} />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="rounded-lg border border-border/75 bg-background/72 p-3 shadow-sm">
          <p className="mb-1 text-[11px] font-black uppercase text-muted-foreground">Oturum</p>
          <p className="truncate text-sm font-bold text-foreground">{user?.email ?? 'Oturum'}</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-black text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <LogOut size={15} />
            Çıkış yap
          </button>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-border/75 bg-background/86 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-xl">
          <div className={`mx-auto flex ${contentWidthClass} items-center justify-between gap-3`}>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black leading-tight text-foreground">{titles[pathname] ?? 'Finans'}</h1>
              <p className="truncate text-xs text-muted-foreground max-[360px]:hidden lg:hidden">{user?.email}</p>
              <p className="hidden truncate text-xs text-muted-foreground lg:block">
                Hesaplarını, planlı ödemelerini ve kişileri tek yerden yönet.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden h-10 items-center gap-2 rounded-lg border border-border/80 bg-card/95 px-3 text-xs font-bold text-muted-foreground shadow-sm sm:flex">
                <CalendarDays size={15} />
                <span>{currentDateLabel()}</span>
              </div>
              <button
                type="button"
                onClick={() => setIsDark((current) => !current)}
                className="grid size-10 place-items-center rounded-lg border border-border/80 bg-card/95 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
                aria-label={isDark ? 'Gündüz temasına geç' : 'Gece temasına geç'}
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="grid size-10 place-items-center rounded-lg border border-border/80 bg-card/95 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground lg:hidden"
                aria-label="Çıkış yap"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>
        <main className={`mx-auto w-full ${contentWidthClass} flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+11rem)] pt-5 lg:px-7 lg:pb-12 lg:pt-7`}>
          <Outlet />
        </main>
        <QuickActions />
        <BottomNav />
      </div>
    </div>
  )
}
