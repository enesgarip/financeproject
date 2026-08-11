import { Eye, EyeOff, LogOut, Moon, MoreHorizontal, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useDailyNetWorthSnapshot } from '../app/useDailyNetWorthSnapshot'
import { useAuth } from '../auth/useAuth'
import { BalancePrivacyProvider, useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { cn } from '../lib/utils'
import { BottomNav } from './BottomNav'
import { contentWidthClass, overflowNavItems, primaryNavItems, routeSubtitle, routeTitle, secondaryNavItems } from './navigation'
import { PullToRefresh } from './PullToRefresh'
import { QuickActionsButton, QuickActionsProvider } from './QuickActions'

/**
 * Uygulama kabuğu — Şerit (`4e`). Kart yok, gölge yok: rail sayfadan 1px
 * `line-strong` ile ayrılır, başlık satırı yine 1px çizgiyle biter.
 *
 * Kırılımlar (README): <768px alt bar + tek kolon · 768–1024px ikon-only rail
 * (56px) · ≥1024px tam rail (216px). Tasarımın 1100px sınırı Tailwind'in `lg`
 * (1024) değerine yuvarlandı — özel bir kırılım açmaya değmiyor.
 */
export function Layout() {
  return (
    <BalancePrivacyProvider>
      <QuickActionsProvider>
        <LayoutInner />
      </QuickActionsProvider>
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

  return (
    <div className="min-h-dvh bg-page text-ink">
      {/* ── Sol rail ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-14 flex-col border-r border-line-strong bg-raised md:flex lg:w-[216px]">
        <div className="flex h-full flex-col gap-6 px-2.5 py-5 lg:px-3.5">
          <div className="hidden px-2 lg:block">
            <p className="font-display text-[17px] font-bold tracking-[-0.01em] text-ink">Denge</p>
            <p className="mt-[3px] text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Kişisel finans</p>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5">
            {primaryNavItems.map((item) => (
              <RailLink key={item.to} item={item} pathname={pathname} />
            ))}
          </nav>

          <div className="border-t border-line pt-3">
            {secondaryNavItems.map((item) => (
              <RailLink key={item.to} item={item} pathname={pathname} />
            ))}
          </div>

          <div className="border-t border-line px-2 pt-3 lg:px-2.5">
            <p className="hidden truncate text-[12.5px] font-semibold text-ink lg:block">{user?.email ?? '—'}</p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-1.5 inline-flex items-center gap-2 rounded-md text-[11px] text-ink-faint transition-colors duration-[120ms] hover:text-ink"
            >
              <LogOut size={13} aria-hidden="true" />
              <span className="hidden lg:inline">Çıkış yap</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── İçerik ── */}
      <div className="flex min-h-dvh flex-col md:pl-14 lg:pl-[216px]">
        <header className="sticky top-0 z-20 bg-page px-5 pb-3 pt-[calc(env(safe-area-inset-top)+0.875rem)] md:px-6 lg:px-[34px] lg:pb-4 lg:pt-6">
          <div className={cn('mx-auto flex items-baseline justify-between gap-4 border-b border-line-strong pb-3 lg:pb-4', contentWidth)}>
            <div className="min-w-0">
              <h1 className="font-display truncate text-[17px] font-bold leading-tight tracking-[-0.02em] text-ink lg:text-[21px]">
                {routeTitle(pathname)}
              </h1>
              {routeSubtitle(pathname) ? (
                <p className="mt-1 hidden truncate text-[13px] text-ink-muted lg:block">{routeSubtitle(pathname)}</p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={toggleBalancesHidden}
                aria-pressed={balancesHidden}
                aria-label={balancesHidden ? 'Tutarları göster' : 'Tutarları gizle'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-[7px] text-[12.5px] text-ink-muted transition-colors duration-[120ms] hover:bg-black/[.02] dark:hover:bg-white/[.03] lg:px-3"
              >
                {balancesHidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                <span className="hidden lg:inline">{balancesHidden ? 'Tutarları göster' : 'Tutarları gizle'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsDark((c) => !c)}
                aria-label={isDark ? 'Gündüz temasına geç' : 'Gece temasına geç'}
                className="inline-flex items-center rounded-lg border border-line-strong p-[7px] text-ink-muted transition-colors duration-[120ms] hover:bg-black/[.02] dark:hover:bg-white/[.03]"
              >
                {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
              </button>

              <div className="hidden lg:block">
                <QuickActionsButton />
              </div>

              {/* Analiz ve Kontrol mobilde alt bara sığmaz; taşma menüsünde. */}
              <div className="relative md:hidden">
                <button
                  type="button"
                  onClick={() => setMenuOpen((c) => !c)}
                  aria-expanded={menuOpen}
                  aria-label="Menü"
                  className="inline-flex items-center rounded-lg border border-line-strong p-[7px] text-ink-muted transition-colors duration-[120ms] hover:bg-black/[.02] dark:hover:bg-white/[.03]"
                >
                  <MoreHorizontal size={15} aria-hidden="true" />
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
                    <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-[14px] border border-line-strong bg-raised p-1.5">
                      {overflowNavItems.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink transition-colors duration-[120ms] hover:bg-black/[.03] dark:hover:bg-white/[.04]"
                        >
                          <item.icon size={16} className="shrink-0 text-ink-faint" aria-hidden="true" />
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main
          className={cn(
            'mx-auto w-full flex-1 px-5 pt-5 md:px-6 lg:px-[34px] lg:pt-6',
            // Alt bar 76px ayrılmış bant + nav satırı taşıyor; içerik onun altına girmez.
            'pb-[calc(env(safe-area-inset-bottom)+9.5rem)] md:pb-14',
            contentWidth,
          )}
        >
          <PullToRefresh>
            <Outlet />
          </PullToRefresh>
        </main>

        <BottomNav />
      </div>
    </div>
  )
}

/**
 * Rail satırı. `md`–`lg` arasında yalnız ikon görünür (56px rail); etiket
 * `sr-only` değil `hidden`, çünkü ikon zaten `aria-label` taşıyan bağlantının
 * içinde ve çift okuma istemiyoruz.
 */
function RailLink({
  item,
  pathname,
}: {
  item: (typeof primaryNavItems)[number]
  pathname: string
}) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      title={item.label}
      className={({ isActive }) => {
        const itemIsActive =
          isActive || ('activePaths' in item && (item.activePaths as readonly string[]).includes(pathname))
        return cn(
          'flex items-center gap-2.5 rounded-[8px] px-2.5 py-[9px] text-[13.5px] transition-colors duration-[120ms]',
          itemIsActive
            ? 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] font-semibold text-primary'
            : 'text-ink-muted hover:bg-[color-mix(in_srgb,var(--primary)_7%,transparent)]',
        )
      }}
    >
      {({ isActive }) => {
        const itemIsActive =
          isActive || ('activePaths' in item && (item.activePaths as readonly string[]).includes(pathname))
        return (
          <>
            <item.icon size={17} strokeWidth={itemIsActive ? 2.2 : 1.8} className="shrink-0" aria-hidden="true" />
            <span className="hidden truncate lg:inline">{item.label}</span>
          </>
        )
      }}
    </NavLink>
  )
}
