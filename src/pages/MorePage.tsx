import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { quickEntryItems } from '../components/navigation'

const tones = [
  'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
  'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
  'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300',
]

export function MorePage() {
  return (
    <section className="flex flex-col gap-4">
      <div className="finance-surface rounded-lg p-4">
        <h1 className="text-lg font-black text-foreground">Daha fazla işlem</h1>
        <p className="mt-1 text-sm text-muted-foreground">Daha seyrek kullanılan finans kayıtları ve hızlı giriş yüzeyleri.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {quickEntryItems.map((item, index) => (
          <Link
            key={item.to}
            to={item.to}
            className="group flex items-center gap-3 rounded-lg border border-border/75 bg-card/95 p-4 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
          >
            <div className={`grid size-11 shrink-0 place-items-center rounded-lg ${tones[index % tones.length]}`}>
              <item.icon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-black text-foreground">{item.title}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
            </div>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
          </Link>
        ))}
      </div>
    </section>
  )
}
