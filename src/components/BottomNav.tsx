import { NavLink, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import { bottomNavItems } from './navigation'
import { QuickActionsFab } from './QuickActions'

/**
 * Mobil alt bar — Şerit (`2a`). Yüzen hap değil, sayfanın dibine oturan düz bant:
 * ayrım 1px çizgiyle yapılır, gölge yok (tek istisna FAB).
 *
 * FAB için 76px'lik bir alan ayrılır ama bu alanın zemini **şeffaftır**; opak
 * olduğunda içeriği görünmez bir çizgide düz kesiyordu — kartların altı yuvarlak
 * köşesi olmadan kırpılıp FAB bölgeyi "yemiş" gibi duruyordu. Şeffaf bantta
 * kart bütün görünür, FAB kaydırma sırasında üstünden geçer.
 *
 * FAB'ın sayfa SONUNDA içeriği örtmemesi ayrılan alandan değil, `main`'in
 * bandın tamamı kadar (152px) alt padding'inden gelir — ikisi Layout'ta eşleşir.
 * Yalnız nav satırı opaktır; onun altından içerik geçmemeli.
 */
export function BottomNav() {
  const { pathname } = useLocation()

  // pt = 62px: ayıraç çizgisi (nav'ın üst kenarlığı) FAB'ın 10px altından geçsin
  // diye — prototipteki ölçü. Sarmalayıcı tıklamayı yutmaz; şeffaf bandın
  // altındaki içerik tıklanabilir kalsın diye yalnız FAB ve nav `pointer-events-auto`.
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 pt-[62px] md:hidden">
      <div className="pointer-events-auto absolute right-4 top-0">
        <QuickActionsFab />
      </div>

      <nav
        aria-label="Ana gezinme"
        className="pointer-events-auto grid grid-cols-5 gap-0.5 border-t border-line-strong bg-page px-3.5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-3.5"
      >
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
