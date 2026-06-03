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

  const userInitial = user?.email?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* ── Desktop Sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col lg:flex">
        {/* Glass border on the right */}
        <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-border/60 to-transparent" />
        <div className="flex h-full flex-col gap-2 p-4"
          style={{ background: 'color-mix(in srgb, var(--card) 85%, transparent)', backdropFilter: 'blur(24px)' }}>

          {/* Brand */}
          <div className="mb-2 flex items-center gap-3 px-1 py-2">
            <div className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-base font-black text-primary-foreground shadow-[0_4px_14px_color-mix(in_srgb,var(--primary)_40%,transparent)]">
              ₺
              <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-success ring-2 ring-card" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black tracking-tight text-foreground">FinanceProject</p>
              <p className="text-[11px] text-muted-foreground">Kişisel finans merkezi</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex flex-1 flex-col gap-0.5">
            <p className="finance-label mb-2 px-3">Navigasyon</p>
            {primaryNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => {
                  const itemIsActive =
                    isActive ||
                    ('activePaths' in item &&
                      (item.activePaths as readonly string[]).includes(pathname))
                  return cn(
                    'group flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-all',
                    itemIsActive
                      ? [
                          'bg-primary text-primary-foreground font-semibold',
                          'shadow-[0_2px_12px_color-mix(in_srgb,var(--primary)_35%,transparent)]',
                        ].join(' ')
                      : 'text-muted-foreground font-medium hover:bg-muted/70 hover:text-foreground',
                  )
                }}
              >
                {({ isActive }) => {
                  const itemIsActive =
                    isActive ||
                    ('activePaths' in item &&
                      (item.activePaths as readonly string[]).includes(pathname))
                  return (
                    <>
                      <item.icon
                        size={17}
                        strokeWidth={itemIsActive ? 2.5 : 2}
                        className="shrink-0"
                      />
                      <span className="truncate">{item.label}</span>
                    </>
                  )
                }}
              </NavLink>
            ))}
          </nav>

          {/* User section */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center gap-2.5">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-xs font-bold text-primary">
                {userInitial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">{user?.email ?? '—'}</p>
                <p className="text-[10px] text-muted-foreground">Oturum açık</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-2.5 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-card/60 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <LogOut size={13} />
              Çıkış yap
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex min-h-dvh flex-col lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-border/60 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
          style={{ background: 'color-mix(in srgb, var(--background) 88%, transparent)', backdropFilter: 'blur(20px)' }}>
          <div className={`mx-auto flex ${contentWidthClass} items-center justify-between gap-3`}>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight tracking-tight text-foreground lg:text-lg">
                {titles[pathname] ?? 'Finans'}
              </h1>
              <p className="hidden truncate text-xs text-muted-foreground lg:block">
                Hesaplarını, planlı ödemelerini ve kişileri tek yerden yönet.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden h-9 items-center gap-2 rounded-xl border border-border/70 bg-card/80 px-3 text-xs font-medium text-muted-foreground backdrop-blur-sm sm:flex">
                <CalendarDays size={13} className="shrink-0" />
                <span>{currentDateLabel()}</span>
              </div>

              <button
                type="button"
                onClick={() => setIsDark((c) => !c)}
                className="grid size-9 place-items-center rounded-xl border border-border/70 bg-card/80 text-muted-foreground backdrop-blur-sm transition hover:bg-muted hover:text-foreground"
                aria-label={isDark ? 'Gündüz temasına geç' : 'Gece temasına geç'}
              >
                {isDark ? <Sun size={16} /> : <Moon size={16} />}
              </button>

              <button
                type="button"
                onClick={() => void signOut()}
                className="grid size-9 place-items-center rounded-xl border border-border/70 bg-card/80 text-muted-foreground backdrop-blur-sm transition hover:bg-muted hover:text-foreground lg:hidden"
                aria-label="Çıkış yap"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        <main className={cn(
          'mx-auto w-full flex-1 px-4 pt-5 lg:px-6 lg:pt-7',
          'pb-[calc(env(safe-area-inset-bottom)+11rem)] lg:pb-14',
          contentWidthClass,
        )}>
          <Outlet />
        </main>

        <QuickActions />
        <BottomNav />
      </div>
    </div>
  )
}
