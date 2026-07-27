import { NavLink } from 'react-router'
import { cn } from '../lib/utils'
import type { HubTab } from './navigation'

/** Premium segmented sub-navigation shared by every product hub. */
export function HubNav({ tabs }: { tabs: HubTab[] }) {
  return (
    <nav
      aria-label="Sayfa bölümleri"
      className="hub-command-nav mb-5 flex w-full items-center gap-1 overflow-x-auto rounded-2xl border border-border/65 bg-card/85 p-1.5 shadow-[var(--shadow-card)]"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'flex min-h-11 min-w-fit flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-center text-sm font-semibold transition-all',
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
