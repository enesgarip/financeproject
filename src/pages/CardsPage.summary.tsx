import { Banknote, ChevronRight, Heart } from 'lucide-react'
import { BankLogo } from '../components/finance/BankLogo'
import { AllCardStatementProjectionPanel } from '../components/finance/AllCardStatementProjectionPanel'
import { HeroNumber } from '../components/serit'
import { DeferredDetails } from '../components/ui/deferred-details'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import type { Card, CardInstallment, CardStatementArchive, CardStatementPayment } from '../types/database'
import { buildStatementPaidMap } from '../utils/cardStatementPayments'
import { buildUpcomingInstallmentPlans } from '../utils/cardInstallmentCalendar'
import { dateInputValue, formatDate } from '../utils/date'
import { diffTL, greaterThanTL, sumTL } from '../utils/money'
import { buildLimitGroupSummaries, getCreditCardDueDate, visibleOpenStatementAmount } from './CardsPage.helpers'
import type { CardPanel } from './CardsPage.hooks'

export function CardsSummary({ rows, installments, statements, statementPayments, installmentsLoading, installmentsError, statementsLoading, statementError, section, panel, onOpenPanel, onOpenCard }: {
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
  onOpenCard?: (card: Card) => void
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
      <section className="pt-4" aria-label="Hesaplar ve nakit özeti">
        <HeroNumber label="Hesap ve nakit toplamı" value={total} description="Güncel bakiyeler · kart borçları düşülmemiştir." />
        <dl className="mt-3 grid grid-cols-2 gap-4 border-y border-line py-3 text-sm">
          <div className="min-w-0"><dt className="text-xs text-ink-muted">Banka hesapları · {accounts.filter((row) => row.account_kind !== 'cash').length}</dt><dd className="serit-num mt-1 break-words font-semibold">{formatAmount(bankBalance)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-ink-muted">Nakit cüzdanları · {accounts.filter((row) => row.account_kind === 'cash').length}</dt><dd className="serit-num mt-1 break-words font-semibold">{formatAmount(cashBalance)}</dd></div>
        </dl>
        <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink-muted">Bakiye kırılımı ve kart borcu sonrası</summary>
        <dl className="mt-2 divide-y divide-line border-y border-line text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3"><dt className="text-ink-muted">Tüm kart borcu sonrası</dt><dd className={`serit-num font-semibold ${diffTL(total, debt) < 0 ? 'text-destructive' : 'text-ink'}`}>{formatAmount(diffTL(total, debt))}</dd></div>
        </dl>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">Kart borcu sonrası fark, gelecek taksit ve provizyonu da içerir. Bu ay harcanabilir tutar Özet ekranındadır.</p>
        </details>
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
    { id: 'donem', label: 'Dönem içi toplam', amount: current, hint: 'Kesinleşmiş · provizyon hariç', unavailable: false },
    { id: 'taksitler', label: 'Gelecek taksit toplamı', amount: future, hint: 'Gelecek aylar ve alışveriş dökümü', unavailable: installmentsLoading || Boolean(installmentsError) },
    { id: 'ekstreler', label: 'Ödenecek ekstre', amount: openStatement, hint: 'Kısmi ödemeler düşülmüş kalan', unavailable: statementsLoading || Boolean(statementError) },
    { id: 'provizyon', label: 'Bekleyen provizyon', amount: provision, hint: 'Henüz kesinleşmeyen harcamalar', unavailable: false },
  ] as const
  return (
    <section className="pt-3" aria-label="Kredi kartları özeti">
      <HeroNumber label="Ödenecek ekstre" value={openStatement} unavailable={statementsLoading || Boolean(statementError)} description={statementsLoading ? 'Ekstreler yükleniyor…' : statementError || 'Kısmi ödemeler düşüldü. Dönem içi harcamalar ve gelecek taksitler bu toplamda yok.'} />
      <CreditLimitSummary rows={rows} onOpenCard={onOpenCard} />
      <h3 className="mt-4 py-3 text-sm font-semibold text-ink-muted">Borç kırılımı ve dökümler</h3>
      <div className="grid grid-cols-2 gap-x-5 border-b border-line" role="navigation" aria-label="Kart dökümleri">
        {metrics.map((metric) => (
          <button key={metric.id} type="button" onClick={() => onOpenPanel(metric.id)} aria-expanded={panel === metric.id}
            aria-controls="kart-bilgi-dokumu" className={`interaction-press min-h-20 min-w-0 border-t px-2 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${panel === metric.id ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-primary/5 hover:text-primary'}`}>
            <span className={`flex items-center justify-between gap-1 text-xs font-semibold ${panel === metric.id ? 'text-primary' : 'text-ink-muted'}`}>{metric.label}<ChevronRight size={15} className={`shrink-0 transition-transform motion-reduce:transition-none ${panel === metric.id ? 'rotate-90' : ''}`} aria-hidden="true" /></span>
            <span className="serit-num mt-2 block break-words text-lg font-semibold leading-tight">{metric.unavailable ? '—' : formatAmount(metric.amount)}</span>
            <span className={metric.unavailable ? 'mt-1 block text-xs text-warning' : 'sr-only'}>{metric.unavailable ? (metric.id === 'taksitler' && installmentsError) || (metric.id === 'ekstreler' && statementError) || 'Yükleniyor…' : metric.hint}</span>
            <span className={panel === metric.id ? 'mt-2 block text-xs font-semibold text-primary' : 'sr-only'}>{panel === metric.id ? 'Döküm açık · Kapat' : 'Dökümü aç'}</span>
          </button>
        ))}
      </div>
      {creditCards.length > 0 ? <DeferredDetails className="mt-3 border-t border-line" summaryClassName="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink-muted" summary="Plan ve tahmin · tüm kartlar">
        <h3 className="mb-3 text-sm font-semibold text-ink">Önümüzdeki 3 ay · tüm kartlar</h3>
        <AllCardStatementProjectionPanel />
      </DeferredDetails> : null}
    </section>
  )
}

export function CreditLimitSummary({ rows, onOpenCard }: { rows: Card[]; onOpenCard?: (card: Card) => void }) {
  const { formatAmount, hidden } = useBalancePrivacy()
  const groups = buildLimitGroupSummaries(rows)
  const limit = sumTL(groups.map((group) => group.limit))
  const used = sumTL(groups.map((group) => group.debt))
  // Her grubun harcanabilir limitini ayrı topla: bir gruptaki aşım diğerini tüketmez.
  const available = sumTL(groups.map((group) => group.available))
  const missingLimits = groups.filter((group) => group.limit <= 0)
  const rate = limit > 0 && missingLimits.length === 0 ? used / limit * 100 : null
  const percent = rate === null ? '—' : hidden ? '••••' : `%${rate.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`
  const overLimit = groups.filter((group) => group.limit > 0 && greaterThanTL(group.debt, group.limit))
  return (
    <section className="mt-4 border-y border-line" aria-label="Toplam limit ve kullanım">
      <details>
        <summary className="interaction-press min-h-11 cursor-pointer list-none py-3 marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2 text-sm font-semibold text-primary">Limit özeti ve kart bazında döküm<ChevronRight size={16} aria-hidden="true" /></span>
          <span className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {[
              ['Toplam limit', formatAmount(limit)],
              ['Kullanılan limit', formatAmount(used)],
              ['Kullanılabilir limit', formatAmount(available)],
              ['Kullanım oranı', percent],
            ].map(([label, value]) => <span key={label} className="min-w-0"><span className="block text-xs text-ink-muted">{label}</span><span className="serit-num mt-1 block break-words text-lg font-semibold text-ink">{value}</span></span>)}
          </span>
          {!hidden && rate !== null ? <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-track" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} /></span> : null}
          <span className="mt-2 block text-xs leading-relaxed text-ink-muted">Kullanım aylık harcama değildir; ekstre, dönem içi, provizyon ve gelecek taksitler dahildir. Ortak limitler bir kez sayılır. Uygulamadaki kayıtlardan hesaplanır.</span>
          {limit === 0 ? <span className="mt-2 block text-xs text-warning">{groups.length ? 'Kart limiti tanımlı değil; kullanım oranı hesaplanamadı.' : 'Henüz kredi kartı yok.'}</span> : null}
          {limit > 0 && missingLimits.length > 0 ? <span className="mt-2 block text-xs text-warning">{missingLimits.length} kart veya grupta limit tanımlı değil; limit toplamı ve kalan limit yalnız bilinen limitleri kapsar.</span> : null}
          {overLimit.length > 0 ? <span className="mt-2 block text-xs font-semibold text-warning">{overLimit.length} kart veya ortak limit grubunda limit aşımı var. Ayrıntılar dökümde.</span> : null}
        </summary>
        <SharedLimitGroups rows={rows} onOpenCard={onOpenCard} />
      </details>
    </section>
  )
}

export function SharedLimitGroups({ rows, onOpenCard }: { rows: Card[]; onOpenCard?: (card: Card) => void }) {
  const { formatAmount, hidden } = useBalancePrivacy()
  const groups = buildLimitGroupSummaries(rows)
  return (
    <section aria-label="Kart ve ortak limit dökümü" className="border-t border-line py-4">
      <h3 className="text-sm font-semibold">Kart ve ortak limit dökümü</h3>
      <p className="mt-2 text-xs text-ink-muted">Aynı gruptaki kartların limiti bir kez sayılır. Grup oluşturmak veya değiştirmek için kartı düzenleyip “Ortak limit grubu” alanını doldur.</p>
      {groups.length ? <div className="mt-3 divide-y divide-line">{groups.map((group) => (
        <details key={group.key} className="py-3">
          <summary className="min-h-11 cursor-pointer break-words py-2 text-sm font-semibold">{group.label} · {group.cards.length} kart</summary>
          <dl className="grid grid-cols-2 gap-3 py-3 text-sm sm:grid-cols-4">
            <div className="min-w-0"><dt className="text-xs text-ink-muted">{group.cards.some((card) => card.limit_group_name?.trim()) ? 'Ortak limit' : 'Kart limiti'}</dt><dd className="serit-num mt-1 break-words font-semibold">{formatAmount(group.limit)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-ink-muted">Kullanılan limit</dt><dd className="serit-num mt-1 break-words font-semibold">{formatAmount(group.debt)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-ink-muted">Kalan limit</dt><dd className="serit-num mt-1 break-words font-semibold">{formatAmount(group.available)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-ink-muted">Kullanım oranı</dt><dd className="serit-num mt-1 break-words font-semibold">{group.limit > 0 ? hidden ? '••••' : `%${(group.debt / group.limit * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}` : '—'}</dd></div>
          </dl>
          {group.limit > 0 && greaterThanTL(group.debt, group.limit) ? <p className="mb-2 text-xs text-warning">Limit aşımı: {formatAmount(diffTL(group.debt, group.limit))}</p> : null}
          {group.limit <= 0 ? <p className="mb-2 text-xs text-warning">Limit tanımlı değil; kullanım oranı hesaplanamadı.</p> : null}
          <ul>{group.cards.map((card) => <li key={card.id}><button type="button" disabled={!onOpenCard} onClick={() => onOpenCard?.(card)} className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-line py-3 text-left text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className="min-w-0 break-words">{card.card_name}{card.holder_name ? ` · ${card.holder_name}` : ''}</span><ChevronRight size={16} className="shrink-0" aria-hidden="true" /></button></li>)}</ul>
        </details>
      ))}</div> : <p className="mt-3 text-sm text-ink-muted">Henüz kredi kartı yok.</p>}
    </section>
  )
}

export function AccountListRow({ card, onOpen, statements, statementPayments, statementsKnown, actionLabel }: { actionLabel?: string; card: Card; onOpen: (card: Card) => void; statements: CardStatementArchive[]; statementPayments: CardStatementPayment[]; statementsKnown: boolean }) {
  const { formatAmount } = useBalancePrivacy()
  const credit = card.card_type === 'kredi_karti'
  const paidMap = buildStatementPaidMap(statementPayments)
  const openAmount = credit ? visibleOpenStatementAmount(card, statements, paidMap) : 0
  const due = credit && openAmount > 0 ? getCreditCardDueDate(card, statements, new Date(), paidMap) : null
  const value = credit ? openAmount > 0 ? openAmount : card.current_period_spending : card.current_balance
  return (
    <button type="button" onClick={() => onOpen(card)} className="flex min-h-20 w-full min-w-0 items-center gap-3 border-b border-line py-4 text-left interaction-press hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      aria-label={actionLabel ?? `${card.card_name} ${credit ? 'kart' : 'hesap'} ayrıntıları`}>
      {card.account_kind === 'cash' ? <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Banknote size={18} aria-hidden="true" /></span> : <BankLogo bankName={card.bank_name} size="sm" />}
      <span className="grid min-w-0 flex-1 gap-x-3 gap-y-2 min-[460px]:grid-cols-[minmax(0,1fr)_auto] min-[460px]:items-center">
        <span className="min-w-0"><span className="flex items-center gap-1 text-sm font-semibold"><span className="min-w-0 break-words">{card.card_name}</span>{card.is_favorite ? <Heart size={12} fill="currentColor" className="shrink-0 text-primary" aria-label="Favori" /> : null}</span><span className="mt-1 block truncate text-xs text-ink-muted">{card.account_kind === 'cash' ? 'Nakit cüzdanı' : card.bank_name}{card.holder_name ? ` · ${card.holder_name}` : ''}</span></span>
        <span className="min-w-0 min-[460px]:text-right"><span className={`serit-num block break-words text-base font-semibold ${!credit && card.current_balance < 0 ? 'text-destructive' : 'text-ink'}`}>{credit && !statementsKnown ? '—' : formatAmount(value)}</span><span className="mt-0.5 block text-xs text-ink-muted">{credit ? !statementsKnown ? 'Ekstre doğrulanamadı' : openAmount > 0 ? `Açık ekstre${due ? ` · ${formatDate(dateInputValue(due))}` : ''}` : 'Dönem içi · açık ekstre yok' : 'Güncel bakiye'}</span></span>
      </span>
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
