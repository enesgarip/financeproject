import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { quickEntryItems } from '../components/navigation'

const tones = [
  'bg-success/12 text-success',
  'bg-destructive/12 text-destructive',
  'bg-warning/12 text-warning',
  'bg-info/12 text-info',
  'bg-primary/12 text-primary',
]

const sections = [
  { id: 'records', title: 'Ek kayıtlar' },
  { id: 'maintenance', title: 'Bakım' },
] as const

export function MorePage() {
  return (
    <section className="flex flex-col gap-5">
      <div className="finance-hero-panel relative overflow-hidden rounded-2xl p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-info to-warning opacity-80" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">Diğer</h1>
        <p className="mt-1 text-sm text-muted-foreground">Krediler, varlıklar ve veri kontrolü.</p>
      </div>

      {sections.map((section) => {
        const items = quickEntryItems.filter((item) => item.section === section.id)
        if (items.length === 0) return null

        return (
          <div key={section.id} className="space-y-2.5">
            <h2 className="finance-label px-1">{section.title}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((item, index) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="group flex items-center gap-3 rounded-2xl border border-border/75 bg-card p-4 shadow-[var(--shadow-card)] transition-all duration-250 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[var(--shadow-lifted)]"
                >
                  <div className={`grid size-11 shrink-0 place-items-center rounded-xl ${tones[index % tones.length]}`}>
                    <item.icon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-bold text-foreground">{item.title}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
