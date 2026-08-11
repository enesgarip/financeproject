import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import type { HubTab } from './navigation'

/**
 * Hub sekme şeridi — Şerit (`4c`). Hap değil, alttan çizgili sekme: aktif olan
 * 2px jade çizgi alır, şeridin kendisi 1px `line-strong` ile içerikten ayrılır.
 * Kahraman rakamın ÜSTÜNDE durur (3. sistem kuralı).
 *
 * İkonlar bilerek çizilmiyor: tasarım sekmeyi metne indiriyor, ikon bu ölçekte
 * gürültü oluyordu. `HubTab.icon` yine de tipte duruyor — alt bar ve rail onu
 * kullanmaya devam ediyor.
 *
 * Mobilde şerit yatay kaydırılır (Plan hub'ında 5 sekme 375px'e sığmaz); aktif
 * sekme rota değişince görüşe kaydırılır.
 */
export function HubNav({ tabs }: { tabs: HubTab[] }) {
  const navRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])

  return (
    <nav
      ref={navRef}
      aria-label="Sayfa bölümleri"
      className="mb-5 flex w-full snap-x items-center gap-[22px] overflow-x-auto border-b border-line-strong [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'flex-none snap-start whitespace-nowrap border-b-2 pb-2.5 text-[13.5px] transition-colors duration-[120ms]',
              isActive
                ? 'border-primary font-semibold text-ink'
                : 'border-transparent text-ink-faint hover:text-ink-muted',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
