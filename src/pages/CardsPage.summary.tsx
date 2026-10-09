import { ChevronRight, Heart } from 'lucide-react'
import { BankLogo } from '../components/finance/BankLogo'
import { HeroNumber } from '../components/serit'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import type { Card, CardInstallment, CardStatementArchive, CardStatementPayment } from '../types/database'
import { buildStatementPaidMap } from '../utils/cardStatementPayments'
import { buildUpcomingInstallmentPlans } from '../utils/cardInstallmentCalendar'
import { formatDate } from '../utils/date'
import { diffTL, sumTL } from '../utils/money'
import { buildLimitGroupSummaries, visibleOpenStatementAmount } from './CardsPage.helpers'
import type { CardPanel } from './CardsPage.hooks'

export function CardsSummary({ rows, installments, statements, statementPayments, installmentsLoading, installmentsError, statementsLoading, statementError, section, panel, onOpenPanel }: {
  rows: Card[]
  installments: CardInstallment[]
  statements: CardStatementArchive[]
  statementPayments: CardStatementPayment[]
  installmentsLoading: boolean
  installmentsError: string
  statementsLoading: boolean
  statementError: string
  section: 'kartlar' | 'hesaplar'
  panel: CardPanel
  onOpenPanel: (panel: CardPanel) => void
}) {
  const { formatAmount } = useBalancePrivacy()
  const creditCards = rows.filter((row) => row.card_type === 'kredi_karti')
  if (section === 'hesaplar') {
    const accounts = rows.filter((row) => row.card_type === 'banka_karti')
    const bankBalance = sumTL(accounts.filter((row) => row.account_kind !== 'cash').map((row) => row.current_balance))
    const cashBalance = sumTL(accounts.filter((row) => row.account_kind === 'cash').map((row) => row.current_balance))
    const total = sumTL([bankBalance, cashBalance])
    const debt = sumTL(creditCards.map((row) => row.debt_amount))
    return (
      <section className="py-5" aria-label="Hesaplar ve nakit özeti">
        <HeroNumber label="Hesap ve nakit toplamı" value={total} description="Güncel bakiyeler · kart borçları düşülmemiştir." />
        <dl className="mt-5 grid gap-3 border-y border-line py-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-ink-muted">Banka hesapları</dt><dd className="mt-1 font-semibold">{formatAmount(bankBalance)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Nakit cüzdanları</dt><dd className="mt-1 font-semibold">{formatAmount(cashBalance)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Tüm kart borcu sonrası</dt><dd className="mt-1 font-semibold">{formatAmount(diffTL(total, debt))}</dd></div>
        </dl>
      </section>
    )
  }
  const creditIds = new Set(creditCards.map((row) => row.id))
  const current = sumTL(creditCards.map((row) => row.current_period_spending))
  const future = sumTL(installments.filter((item) => creditIds.has(item.card_id) && item.status === 'scheduled').map((item) => item.amount))
  const paidMap = buildStatementPaidMap(statementPayments)
  const openStatement = sumTL(creditCards.map((row) => visibleOpenStatementAmount(row, statements, paidMap)))
  const provision = sumTL(creditCards.map((row) => row.provision_amount ?? 0))
  const metrics = [
    { id: 'donem', label: 'Dönem içi toplam', amount: current, hint: 'Kesinleşmiş · provizyon hariç', prominent: true, unavailable: false },
    { id: 'taksitler', label: 'Gelecek taksit toplamı', amount: future, hint: 'Gelecek aylar ve alışveriş dökümü', prominent: true, unavailable: installmentsLoading || Boolean(installmentsError) },
    { id: 'ekstreler', label: 'Ödenecek ekstre', amount: openStatement, hint: 'Kısmi ödemeler düşülmüş kalan', prominent: false, unavailable: statementsLoading || Boolean(statementError) },
    { id: 'provizyon', label: 'Bekleyen provizyon', amount: provision, hint: 'Henüz kesinleşmeyen harcamalar', prominent: false, unavailable: false },
  ] as const
  return (
    <section className="py-4" aria-label="Kredi kartları özeti">
      <div className="grid grid-cols-2 gap-x-5 divide-y-0 border-b border-line">
        {metrics.map((metric) => (
          <button key={metric.id} type="button" onClick={() => onOpenPanel(metric.id)} aria-expanded={panel === metric.id}
            aria-controls="kart-bilgi-dokumu" className="min-w-0 border-t border-line py-4 text-left transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <span className="flex items-center justify-between gap-1 text-xs font-semibold text-ink-muted">{metric.label}<ChevronRight size={15} aria-hidden="true" /></span>
            <span className={`serit-num mt-2 block break-words font-semibold ${metric.prominent ? 'text-[clamp(1.25rem,4.6vw,2.5rem)] leading-tight' : 'text-lg'}`}>{metric.unavailable ? '—' : formatAmount(metric.amount)}</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-muted">{metric.unavailable ? (metric.id === 'taksitler' && installmentsError) || (metric.id === 'ekstreler' && statementError) || 'Yükleniyor…' : metric.hint}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-muted">Toplam kart yükü <strong className="font-semibold text-ink">{formatAmount(sumTL(creditCards.map((row) => row.debt_amount)))}</strong> · ekstre, dönem içi, provizyon ve gelecek taksitler dahil.</p>
    </section>
  )
}

export function SharedLimitGroups({ rows, onOpenCard }: { rows: Card[]; onOpenCard: (card: Card) => void }) {
  const { formatAmount } = useBalancePrivacy()
  const groups = buildLimitGroupSummaries(rows).filter((group) => group.cards.some((card) => card.limit_group_name?.trim()))
  return (
    <section aria-label="Ortak limit grupları" className="border-t border-line py-4">
      <h3 className="text-sm font-semibold">Ortak limit grupları</h3>
      <p className="mt-2 text-xs text-ink-muted">Aynı gruptaki kartların limiti bir kez sayılır. Grup oluşturmak veya değiştirmek için kartı düzenleyip “Ortak limit grubu” alanını doldur.</p>
      {groups.length ? <div className="mt-3 divide-y divide-line">{groups.map((group) => (
        <details key={group.key} className="py-3">
          <summary className="min-h-11 cursor-pointer break-words py-2 text-sm font-semibold">{group.label} · {group.cards.length} kart</summary>
          <dl className="grid gap-3 py-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-ink-muted">Ortak limit</dt><dd className="mt-1 font-semibold">{formatAmount(group.limit)}</dd></div>
            <div><dt className="text-xs text-ink-muted">Toplam kart borcu</dt><dd className="mt-1 font-semibold">{formatAmount(group.debt)}</dd></div>
            <div><dt className="text-xs text-ink-muted">Kalan limit</dt><dd className="mt-1 font-semibold">{formatAmount(group.available)}</dd></div>
          </dl>
          <ul>{group.cards.map((card) => <li key={card.id}><button type="button" onClick={() => onOpenCard(card)} className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-line py-3 text-left text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className="min-w-0 break-words">{card.card_name}{card.holder_name ? ` · ${card.holder_name}` : ''}</span><ChevronRight size={16} className="shrink-0" aria-hidden="true" /></button></li>)}</ul>
        </details>
      ))}</div> : <p className="mt-3 text-sm text-ink-muted">Henüz ortak limit grubu yok.</p>}
    </section>
  )
}

export function AccountListRow({ card, onOpen }: { card: Card; onOpen: (card: Card) => void }) {
  const { formatAmount } = useBalancePrivacy()
  const credit = card.card_type === 'kredi_karti'
  return (
    <button type="button" onClick={() => onOpen(card)} className="flex min-h-20 w-full min-w-0 items-center gap-3 border-b border-line py-4 text-left hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      aria-label={`${card.card_name} ${credit ? 'kart' : 'hesap'} ayrıntıları`}>
      <BankLogo bankName={card.bank_name} size="sm" />
      <span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-sm font-semibold"><span className="truncate">{card.card_name}</span>{card.is_favorite ? <Heart size={12} fill="currentColor" className="shrink-0 text-primary" aria-label="Favori" /> : null}</span><span className="mt-1 block truncate text-xs text-ink-muted">{card.account_kind === 'cash' ? 'Nakit cüzdanı' : card.bank_name}{card.holder_name ? ` · ${card.holder_name}` : ''}</span></span>
      <span className="shrink-0 text-right"><span className="serit-num block text-sm font-semibold">{formatAmount(credit ? card.current_period_spending : card.current_balance)}</span><span className="mt-1 block text-[11px] text-ink-muted">{credit ? 'Dönem içi' : 'Güncel bakiye'}</span></span>
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />
    </button>
  )
}

export function UpcomingInstallmentPlans({ installments, cards, loading }: { installments: CardInstallment[]; cards: Card[]; loading: boolean }) {
  const { formatAmount } = useBalancePrivacy()
  const plans = buildUpcomingInstallmentPlans(installments)
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  return (
    <section aria-label="Gelecek taksitlerin alışveriş dökümü">
      <h3 className="text-sm font-semibold">Hangi alışverişler var?</h3>
      {loading ? <p role="status" className="py-4 text-sm text-ink-muted">Taksitler yükleniyor…</p> : plans.length ? <div className="mt-2 divide-y divide-line">{plans.map((plan) => (
        <details key={plan.id} className="py-3">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span className="min-w-0"><span className="block text-sm font-semibold">{plan.description}</span><span className="mt-1 block text-xs text-ink-muted">{cardsById.get(plan.cardId)?.card_name ?? 'Kart'} · {plan.items.length} gelecek taksit · {formatDate(plan.items[0].due_month)} – {formatDate(plan.items[plan.items.length - 1].due_month)}</span></span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatAmount(plan.total)}</span>
          </summary>
          <ul className="mt-2 space-y-2 border-l border-line pl-3 text-xs text-ink-muted">{plan.items.map((item) => <li key={item.id} className="flex justify-between gap-3"><span>{formatDate(item.due_month)} · {item.installment_no}/{item.installment_count}</span><span>{formatAmount(item.amount)}</span></li>)}</ul>
        </details>
      ))}</div> : <p className="py-4 text-sm text-ink-muted">Gelecek taksit bulunmuyor.</p>}
    </section>
  )
}

export function PeriodSpendingBreakdown({ cards }: { cards: Card[] }) {
  const { formatAmount } = useBalancePrivacy()
  const creditCards = cards.filter((card) => card.card_type === 'kredi_karti')
  return <section aria-label="Dönem içi borç kırılımı">
    <h3 className="text-sm font-semibold">Dönem içi borç kırılımı</h3>
    <dl className="mt-3 divide-y divide-line">{creditCards.map((card) => <div key={card.id} className="flex justify-between gap-3 py-3 text-sm"><dt>{card.card_name}{card.holder_name ? ` · ${card.holder_name}` : ''}</dt><dd className="shrink-0 font-semibold tabular-nums">{formatAmount(card.current_period_spending)}</dd></div>)}</dl>
    <p className="mt-3 text-xs text-ink-muted">Provizyon ve gelecek taksitler dönem içi toplama dahil değildir. Aşağıdaki son 20 hareket listesi geçmiş ekstrelerdeki alışverişleri de içerebilir.</p>
  </section>
}
