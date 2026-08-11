import { NavLink, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import { bottomNavItems } from './navigation'
import { QuickActionsFab } from './QuickActions'

/**
 * Mobil alt bar — Şerit (`2a`). Yüzen hap değil, sayfanın dibine oturan düz bant:
 * ayrım 1px çizgiyle yapılır, gölge yok.
 *
 * Sarmalayıcı FAB için **76px'lik ayrılmış bant** taşır ve bandın zemini sayfa
 * rengiyle doludur — FAB hiçbir kaydırma konumunda içeriğin üstüne binmez.
 * (Eski yüzen FAB sayfa sonunda satırları örtüyordu.) Bandın yüksekliği
 * `main`'in alt padding'iyle eşleşmeli; ikisi de Layout'ta.
 */
export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 bg-page pt-[76px] md:hidden">
      {/* Ayıraç FAB'ın 10px altından geçer; FAB çizginin üstünde durur. */}
      <div className="pointer-events-none absolute inset-x-0 top-[62px] border-t border-line-strong" aria-hidden="true" />

      <div className="absolute right-4 top-0">
        <QuickActionsFab />
      </div>

      <nav className="grid grid-cols-5 gap-0.5 px-3.5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-3.5">
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className="flex min-w-0 flex-col items-center gap-[5px] rounded-lg py-1"
          >
            {({ isActive }) => {
              const itemIsActive =
                isActive ||
                ('activePaths' in item && (item.activePaths as readonly string[]).includes(pathname))
              return (
                <>
                  <item.icon
                    size={20}
                    strokeWidth={itemIsActive ? 2.2 : 1.8}
                    style={{ color: itemIsActive ? 'var(--primary)' : 'var(--ink-faint)' }}
                    aria-hidden="true"
                  />
                  <span
                    className={cn('truncate text-[10.5px] leading-none', itemIsActive ? 'font-semibold' : 'font-normal')}
                    style={{ color: itemIsActive ? 'var(--primary)' : 'var(--ink-faint)' }}
                  >
                    {item.label}
                  </span>
                </>
              )
            }}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
