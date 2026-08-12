import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  ListChecks,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Card, CardContent } from '../ui/card'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'

export type FocusAction = {
  id: string
  title: string
  description: string
  to: string
  cta: string
  tone: 'emerald' | 'amber' | 'rose' | 'indigo' | 'stone'
  icon: 'alert' | 'calendar' | 'card' | 'check' | 'health' | 'loan'
  priority: number
}

export function FocusActionPanel({
  actions,
  safeToSpendAmount,
}: {
  actions: FocusAction[]
  /**
   * Kahraman rakamla AYNI sayı (buildSafeToSpend çıktısı). Eskiden burada
   * tampon/rezerv düşülmemiş `cashFlow.projectedCash` gösteriliyordu; aynı
   * ekranda iki farklı "ay sonu" rakamı vardı (denetim 2026-08-12 K10).
   */
  safeToSpendAmount: number
}) {
  const { formatAmount } = useBalancePrivacy()
  const [showAll, setShowAll] = useState(false)
  const primaryAction = actions[0]
  if (!primaryAction) return null
  const cashIsPositive = safeToSpendAmount >= 0
  const statusLabel = primaryAction.priority <= 20 ? 'Aksiyon gerekli' : 'Takip temiz'
  const visibleActions = showAll ? actions : actions.slice(0, 4)
  const hiddenCount = Math.max(0, actions.length - 4)

  return (
    <Card className="border-0 bg-card/95 py-0 ring-1 ring-border/80">
      <CardContent className="p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:items-stretch">
          <div className="flex min-w-0 flex-col justify-between rounded-lg border border-border/75 bg-surface-muted p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-primary">Bugünün odağı</p>
                <h2 className="mt-2 text-2xl font-black leading-tight text-foreground">{statusLabel}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  En önemli finans aksiyonlarını vade, bakiye ve limit durumuna göre sıraladım.
                </p>
              </div>
              <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15" aria-hidden="true">
                <ListChecks size={21} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-card/80 px-3 py-2 ring-1 ring-border/70">
                <p className="font-bold uppercase text-muted-foreground">Ay sonuna kalan</p>
                <p className={`finance-value mt-1 truncate text-sm font-extrabold ${cashIsPositive ? 'text-success' : 'text-destructive'}`}>
                  {formatAmount(safeToSpendAmount)}
                </p>
              </div>
              <div className="rounded-lg bg-card/80 px-3 py-2 ring-1 ring-border/70">
                <p className="font-bold uppercase text-muted-foreground">Sıradaki</p>
                <p className="mt-1 truncate text-sm font-extrabold text-foreground">{primaryAction.cta}</p>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <div className="grid gap-2 min-[720px]:grid-cols-2">
              {visibleActions.map((action) => (
                <FocusActionCard key={action.id} action={action} />
              ))}
            </div>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                aria-expanded={showAll}
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground  transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                {showAll ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                {showAll ? 'Aksiyonları daralt' : `Tüm aksiyonları göster (${actions.length})`}
              </button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function FocusActionCard({ action }: { action: FocusAction }) {
  // Başlık/açıklama util katmanında üretilen serbest metin ve tutar içerebilir
  // ("1.000,00 ₺ provizyon bekliyor") — gizlilik modunda maskelenmeli (K1).
  const { maskText } = useBalancePrivacy()
  const Icon = {
    alert: AlertTriangle,
    calendar: CalendarDays,
    card: CreditCard,
    check: CheckCircle2,
    health: ShieldCheck,
    loan: Landmark,
  }[action.icon]
  const toneClass = {
    emerald: 'border-success/20 bg-card text-foreground ring-success/15 hover:border-success/35',
    amber: 'border-warning/25 bg-card text-foreground ring-warning/15 hover:border-warning/40',
    rose: 'border-destructive/20 bg-card text-foreground ring-destructive/15 hover:border-destructive/35',
    indigo: 'border-info/20 bg-card text-foreground ring-info/15 hover:border-info/35',
    stone: 'border-border bg-card text-foreground ring-border/70 hover:border-muted-foreground/35',
  }[action.tone]
  const iconClass = {
    emerald: 'bg-success/10 text-success',
    amber: 'bg-warning/12 text-warning',
    rose: 'bg-destructive/10 text-destructive',
    indigo: 'bg-info/10 text-info',
    stone: 'bg-muted text-muted-foreground',
  }[action.tone]
  const stripeClass = {
    emerald: 'accent-stripe-emerald',
    amber: 'accent-stripe-amber',
    rose: 'accent-stripe-rose',
    indigo: 'accent-stripe-indigo',
    stone: 'accent-stripe-stone',
  }[action.tone]

  return (
    <Link
      to={action.to}
      className={`group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-lg border p-3 pl-4  ring-1 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${toneClass}`}
    >
      <span className={`accent-stripe ${stripeClass}`} aria-hidden="true" />
      <div className="flex items-start gap-3">
        <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${iconClass}`} aria-hidden="true">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold leading-snug">{maskText(action.title)}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{maskText(action.description)}</p>
        </div>
      </div>
      <span className="mt-3 inline-flex items-center text-xs font-black uppercase tracking-normal text-muted-foreground group-hover:text-foreground">
        {action.cta}
        <ArrowUpRight className="ml-1 size-3.5" />
      </span>
    </Link>
  )
}

