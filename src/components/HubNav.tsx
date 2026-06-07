import { NavLink } from 'react-router-dom'
import { cn } from '../lib/utils'
import type { HubTab } from './navigation'

/** Sub-tab navigation for a hub page (Varlıklar, Borçlar). Renders pill-style NavLinks. */
export function HubNav({ tabs }: { tabs: HubTab[] }) {
  return (
    <nav className="mb-5 inline-flex w-full max-w-md items-center gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition-all',
              isActive
                ? 'bg-card text-foreground shadow-[var(--shadow-card)]'
                : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
