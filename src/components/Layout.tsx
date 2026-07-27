import { CalendarDays, Eye, EyeOff, LogOut, Moon, MoreHorizontal, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useDailyNetWorthSnapshot } from '../app/useDailyNetWorthSnapshot'
import { useAuth } from '../auth/useAuth'
import { BalancePrivacyProvider, useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { cn } from '../lib/utils'
import { BottomNav } from './BottomNav'
import { contentWidthClass, overflowNavItems, primaryNavItems, routeSubtitle, routeTitle, secondaryNavItems } from './navigation'
import { PullToRefresh } from './PullToRefresh'
import { QuickActions } from './QuickActions'
import { AppMark } from './AppMark'

function currentDateLabel() {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())
}

export function Layout() {
  return (
    <BalancePrivacyProvider>
      <LayoutInner />
    </BalancePrivacyProvider>
  )
}

function LayoutInner() {
  const { pathname } = useLocation()
  const { signOut, user } = useAuth()
  // Günlük net değer fotoğrafı: hangi sayfayla açılırsa açılsın alınır.
  useDailyNetWorthSnapshot()
  const contentWidth = contentWidthClass(pathname)
  const [isDark, setIsDark] = useState(() => {
    const storedTheme = localStorage.getItem('theme')
    return storedTheme ? storedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const { hidden: balancesHidden, toggleHidden: toggleBalancesHidden } = useBalancePrivacy()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const userInitial = user?.email?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* ── Desktop Sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col lg:flex">
        <div className="app-sidebar flex h-full flex-col gap-2 p-5">

          {/* Brand */}
          <div className="mb-5 flex items-center gap-3 px-1 py-1">
            <AppMark className="size-10 shadow-[0_5px_16px_color-mix(in_srgb,var(--primary)_24%,transparent)]" />
            <div className="min-w-0">
              <p className="font-display text-[15px] font-semibold tracking-tight text-foreground">Denge</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Kişisel finans</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex flex-1 flex-col gap-0.5">
            <p className="finance-label mb-2.5 px-3">Navigasyon</p>
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
                    'group relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                    itemIsActive
                      ? [
                          'bg-primary/10 text-primary font-semibold',
                          'before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
                        ].join(' ')
                      : 'text-muted-foreground font-medium hover:bg-muted/65 hover:text-foreground',
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

          {/* Maintenance + user section */}
          {secondaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'relative mb-3 flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                    : 'text-muted-foreground font-medium hover:bg-muted/70 hover:text-foreground',
                )
              }
            >
              <item.icon size={17} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
          <div className="rounded-2xl border border-border/75 bg-background/65 p-3.5">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-bold text-primary ring-1 ring-primary/15">
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
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-card text-xs font-semibold text-muted-foreground transition hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
            >
              <LogOut size={13} />
              Çıkış yap
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex min-h-dvh flex-col lg:pl-72">
        {/* Header */}
        <header className="app-header sticky top-0 z-20 px-4 pb-3.5 pt-[calc(env(safe-area-inset-top)+0.875rem)] lg:px-7 lg:py-4">
          <div className={`mx-auto flex ${contentWidth} items-center justify-between gap-4`}>
            <div className="min-w-0">
              <h1 className="font-display truncate text-lg font-semibold leading-tight tracking-tight text-foreground lg:text-xl">
                {routeTitle(pathname)}
              </h1>
              {routeSubtitle(pathname) ? (
                <p className="hidden truncate text-xs text-muted-foreground lg:block">
                  {routeSubtitle(pathname)}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden h-9 items-center gap-2 rounded-xl border border-border/70 bg-card/80 px-3 text-xs font-medium text-muted-foreground backdrop-blur-sm sm:flex">
                <CalendarDays size={13} className="shrink-0" />
                <span>{currentDateLabel()}</span>
              </div>

              <button
                type="button"
                onClick={toggleBalancesHidden}
                aria-pressed={balancesHidden}
                className="app-icon-button size-10 rounded-xl"
                aria-label={balancesHidden ? 'Tutarları göster' : 'Tutarları gizle'}
              >
                {balancesHidden ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>

              <button
                type="button"
                onClick={() => setIsDark((c) => !c)}
                className="app-icon-button size-10 rounded-xl"
                aria-label={isDark ? 'Gündüz temasına geç' : 'Gece temasına geç'}
              >
                {isDark ? <Sun size={16} /> : <Moon size={16} />}
              </button>

              <div className="relative lg:hidden">
                <button
                  type="button"
                  onClick={() => setMenuOpen((c) => !c)}
                  aria-expanded={menuOpen}
                  aria-label="Menü"
                  className="app-icon-button size-10 rounded-xl"
                >
                  <MoreHorizontal size={16} />
                </button>

                {menuOpen ? (
                  <>
                    <button
                      type="button"
                      aria-hidden
                      tabIndex={-1}
                      onClick={() => setMenuOpen(false)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div className="finance-command-surface absolute right-0 top-full z-50 mt-2 w-56 rounded-xl p-1.5">
                      {overflowNavItems.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
                        >
                          <item.icon size={16} className="shrink-0 text-muted-foreground" />
                          {item.label}
                        </Link>
                      ))}
                      <div className="my-1 h-px bg-border/60" />
                      <button
                        type="button"
                        onClick={() => void signOut()}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive/10"
                      >
                        <LogOut size={16} className="shrink-0" />
                        Çıkış yap
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className={cn(
          'mx-auto w-full flex-1 px-4 pt-5 lg:px-7 lg:pt-8',
          'pb-[calc(env(safe-area-inset-bottom)+11rem)] lg:pb-14',
          contentWidth,
        )}>
          <PullToRefresh>
            <Outlet />
          </PullToRefresh>
        </main>

        <QuickActions />
        <BottomNav />
      </div>
    </div>
  )
}
