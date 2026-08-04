import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import type { HubTab } from './navigation'

/**
 * Premium segmented sub-navigation shared by every product hub.
 *
 * Mobil: sekmeler içerik-boyunda ve yatay kaydırılır (`flex-none`) — eski
 * `flex-1` hepsini ekrana sıkıştırıp dokunma alanını daraltıyordu. Aktif sekme
 * rota değişince görüşe kaydırılır, kenardaki yarım sekme "kaydırılabilir"
 * ipucu verir. Desktop (sm+): sekmeler şeridi eşit doldurur (`sm:flex-1`).
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
      className="hub-command-nav mb-5 flex w-full snap-x items-center gap-1 overflow-x-auto rounded-2xl border border-border/65 bg-card/85 p-1.5 shadow-[var(--shadow-card)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'flex min-h-11 flex-none snap-start items-center justify-center gap-2 rounded-xl px-4 py-2 text-center text-sm font-semibold transition-all sm:flex-1',
              isActive
                ? 'bg-primary text-primary-foreground shadow-[0_6px_18px_color-mix(in_srgb,var(--primary)_22%,transparent)]'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )
          }
        >
          <tab.icon size={16} strokeWidth={2.2} aria-hidden="true" />
          <span className="whitespace-nowrap">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
