import { AlertTriangle, Banknote, Check, CheckCircle2, Copy, ShieldCheck } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { BankLogo } from '../components/finance/BankLogo'
import { AccountLedgerPanel } from '../components/finance/AccountLedgerPanel'
import { CardAliasPanel } from '../components/finance/CardAliasPanel'
import { CardLedgerPanel } from '../components/finance/CardLedgerPanel'
import { MiniStat, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import { fetchAllCardAliases } from '../data/repositories/cardAliasesRepo'
import { fetchExpensePaceRows } from '../data/repositories/cardsRepo'
import { fetchAccountLedgerEvents } from '../data/repositories/financePanelsRepo'
import type { AccountReconciliation, Card, CardInstallment, CardStatementArchive } from '../types/database'
import { addDays, dateInputValue, daysUntil, startOfDay } from '../utils/date'
import { freshnessConfidence } from '../utils/dataConfidence'
import { STALE_AFTER_DAYS } from '../utils/reconciliation'
import { formatDate } from '../utils/date'
import { cardPayableDebt } from '../utils/financeSummary'
import { buildStatementPace } from '../utils/statementPace'
import { quickCardConsistencyScore } from '../utils/cardConsistency'
import { bankBrandGradient, getBankBrand } from '../utils/bankBranding'
import { buildAccountLedgerBalanceRows } from '../utils/accountLedger'
import { sumTL, toTL } from '../utils/money'
import {
  activeInstallmentCount,
  bankHueStyle,
  formatIban,
  formatMonthlyDay,
  formatShortDate,
  getCreditCardDueDate,
  getCreditCardStatus,
  limitGroupStats,
  statementPeriodLabel,
  visibleOpenStatementAmount,
} from './CardsPage.helpers'
import { CardDatum } from './CardsPage.overview'
import { LineGroup } from '../components/serit'
import { formatCurrency } from '../utils/formatCurrency'
import { Button } from '../components/ui/button'

function AccountRecentTransactions({
  card,
  formatAmount,
}: {
  card: Card
  formatAmount: (value: number | null | undefined) => string
}) {
  const { user } = useAuth()
  // Eski useEffect sürümü her mount'ta tüm hesap geçmişini çekip 3'e kesiyordu;
  // limit DB'de, sonuç TanStack cache'inde (remount bedava).
  const { data: events } = useQuery({
    queryKey: ['account-ledger-recent', user?.id, card.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const result = await fetchAccountLedgerEvents(card.id, 3)
      return result.ok ? result.data : []
    },
  })

  if (!events || events.length === 0) return null

  const rows = buildAccountLedgerBalanceRows(events, card.current_balance)

  return (
    <section className="account-activity-panel mt-4 rounded-2xl border border-line-strong bg-raised p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="finance-label">Son 3 hareket</p>
        <span className="text-[11px] font-semibold text-ink-muted">{rows.length} kayıt</span>
      </div>
      <div className="mt-2.5 divide-y divide-line">
        {rows.map(({ event, balanceAfter }) => {
          const amount = toTL(event.amount_kurus)
          const isInflow = amount >= 0
          return (
            <div key={event.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5 text-xs first:pt-1">
              <span className="flex min-w-0 items-center gap-2 truncate">
                <span className={isInflow ? 'size-2 shrink-0 rounded-full bg-success' : 'size-2 shrink-0 rounded-full bg-destructive'} />
                <span className={isInflow ? 'font-black text-success' : 'font-black text-destructive'}>
                  {isInflow ? 'Giriş' : 'Çıkış'}
                </span>
                <span className="ml-2 text-ink-muted">{formatDate(event.occurred_at.slice(0, 10))}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={isInflow ? 'font-black text-success' : 'font-black text-destructive'}>
                  {amount > 0 ? '+' : ''}{formatAmount(amount)}
                </span>
                <span className="ml-2 hidden text-ink-muted min-[460px]:inline">Sonrası {formatAmount(balanceAfter)}</span>
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// Dönem temposu verisi: son 70 gün (iki tam dönemi fazlasıyla kapsar) tüm
// kartların hafif harcama satırları TEK sorguda. Satırlar aynı anahtarı
// paylaştığı için TanStack liste başına bir isteğe tekilleştirir
// (card-aliases deseni); banka hesabı satırlarında sorgu hiç açılmaz.
function useStatementPaceRows(enabled: boolean) {
  const { user } = useAuth()
  const sinceIso = dateInputValue(addDays(startOfDay(new Date()), -70))
  const { data } = useQuery({
    queryKey: ['card-expense-pace', user?.id, sinceIso],
    enabled: Boolean(user) && enabled,
    queryFn: async () => {
      const result = await fetchExpensePaceRows(sinceIso)
      return result.ok ? result.data : []
    },
  })
  return data
}

function CardMaskedNumber({ cardId, hidden }: { cardId: string; hidden: boolean }) {
  const { user } = useAuth()
  // Tüm satırlar aynı anahtarı paylaşır → TanStack istekleri tekilleştirir:
  // kart başına bir sorgu yerine liste başına tek toplu sorgu.
  const { data: aliases } = useQuery({
    queryKey: ['card-aliases', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const result = await fetchAllCardAliases()
      return result.ok ? result.data : []
    },
  })
  const digits = aliases?.find((alias) => alias.card_id === cardId)?.last_four_digits ?? null

  return (
    <p className="mt-3 font-mono text-sm font-black text-white/78">
      {hidden ? '**** ****' : digits ? `**** ${digits}` : '**** ----'}
    </p>
  )
}

export function CreditAccountListCard({
  row,
  rows,
  statements,
  installments,
  reconciliations = [],
  menu,
  rowActions,
  ledgerOpen = false,
  detailsOpen = false,
  balancesHidden = false,
  formatAmount = formatCurrency,
  onPayDebt,
  onAddExpense,
  onChanged,
}: {
  row: Card
  rows: Card[]
  statements: CardStatementArchive[]
  installments: CardInstallment[]
  reconciliations?: AccountReconciliation[]
  menu: React.ReactNode
  rowActions: React.ReactNode
  ledgerOpen?: boolean
  detailsOpen?: boolean
  balancesHidden?: boolean
  formatAmount?: (value: number | null | undefined) => string
  onPayDebt: (card: Card) => void
  onAddExpense: (card: Card, mode: 'cash' | 'installment') => void
  onChanged?: () => void | Promise<void>
}) {
  const [ibanCopied, setIbanCopied] = useState(false)

  const paceRows = useStatementPaceRows(row.card_type === 'kredi_karti')
  // Gün anahtarı memo'yu gün dönüşünde tazeler; tarih memo içinde o güne sabit.
  const todayValue = dateInputValue(new Date())
  const pace = useMemo(
    () =>
      row.card_type === 'kredi_karti'
        ? buildStatementPace(row, paceRows ?? [], new Date(`${todayValue}T12:00:00`))
        : null,
    [row, paceRows, todayValue],
  )

  const handleCopyIban = useCallback(async () => {
    if (!row.iban) return
    try {
      await navigator.clipboard.writeText(row.iban)
      setIbanCopied(true)
      window.setTimeout(() => setIbanCopied(false), 1600)
    } catch {
      setIbanCopied(false)
    }
  }, [row.iban])

  if (row.card_type === 'banka_karti') {
    return (
      <article
        style={bankHueStyle(row.bank_name, rows)}
        className="premium-entity-card account-entity-card finance-panel relative min-w-0 overflow-hidden rounded-2xl border-[hsl(var(--bank-hue)_45%_82%/0.72)] p-4 min-[390px]:p-5 dark:border-[hsl(var(--bank-hue)_35%_38%/0.55)]"
      >
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3.5">
            <BankLogo bankName={row.bank_name} size="lg" className="size-14 rounded-2xl text-sm " />
            <div className="min-w-0">
              <h2 className="truncate font-display text-lg font-bold tracking-tight text-ink">{row.card_name}</h2>
              <p className="mt-1 truncate text-sm font-medium text-ink-muted">{row.bank_name} · banka hesabı</p>
            </div>
          </div>
          <div className="entity-card-menu">{menu}</div>
        </div>

        <div className="relative mt-5 border-t border-line pt-4">
          <p className="finance-label">Kullanılabilir bakiye</p>
          <p className="finance-value mt-2 truncate text-[clamp(1.8rem,7vw,2.75rem)] font-bold leading-none tracking-tight text-ink">
            {formatAmount(row.current_balance)}
          </p>
        </div>

        <LineGroup className="mt-3 border-t border-line pt-1">
          <CardDatum label="Tür" value="Banka hesabı" />
          <CardDatum label="Not" value={row.note || '-'} />
        </LineGroup>

        {row.iban ? (
          <div className="mt-3 rounded-xl border border-line-strong bg-page px-3 py-2.5">
            <p className="finance-label">IBAN</p>
            <button
              type="button"
              onClick={handleCopyIban}
              className="mt-1.5 flex min-h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md text-left font-mono text-xs font-bold tabular-nums text-ink transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 truncate">{balancesHidden ? '••••' : formatIban(row.iban)}</span>
              {ibanCopied ? <Check size={14} className="shrink-0 text-success" /> : <Copy size={14} className="shrink-0 text-ink-muted" />}
            </button>
          </div>
        ) : null}

        <AccountRecentTransactions card={row} formatAmount={formatAmount} />

        {ledgerOpen ? <AccountLedgerPanel card={row} onChanged={onChanged} formatAmount={formatAmount} /> : null}
        {rowActions}
      </article>
    )
  }

  const stats = limitGroupStats(row, rows)
  const usageRate = Math.round(stats.usageRate)
  const lastReconciledAt = reconciliations
    .filter((item) => item.card_id === row.id)
    .map((item) => item.reconciled_at)
    .sort()
    .at(-1)
  const debtConfidence = freshnessConfidence(
    lastReconciledAt ? -(daysUntil(lastReconciledAt.slice(0, 10)) ?? 0) : null,
    STALE_AFTER_DAYS,
    'Bu kartın borcu',
  )
  const dueDate = getCreditCardDueDate(row, statements)
  const status = getCreditCardStatus(row, stats.usageRate, statements)
  const displayedOpenStatementAmount = visibleOpenStatementAmount(row, statements)
  const installmentCount = activeInstallmentCount(row, installments)
  const scheduledInstallmentTotal = sumTL(installments
    .filter((installment) => installment.card_id === row.id && installment.status === 'scheduled')
    .map((installment) => installment.amount))
  const payableDebt = cardPayableDebt(row)
  const openStatements = statements.filter((statement) => statement.card_id === row.id && statement.status === 'open')
  const cardInstallments = installments
    .filter((installment) => installment.card_id === row.id && installment.status !== 'paid')
    .sort((left, right) => left.due_month.localeCompare(right.due_month))
  const consistency = quickCardConsistencyScore(row, installments, rows)

  return (
    <article
      style={bankHueStyle(row.bank_name, rows)}
      className="premium-entity-card credit-entity-card finance-panel relative min-w-0 overflow-hidden rounded-2xl bg-raised ring-1 ring-[hsl(var(--bank-hue)_42%_82%/0.55)] dark:ring-[hsl(var(--bank-hue)_40%_42%/0.45)]"
    >
      <div
        style={{ backgroundImage: bankBrandGradient(row.bank_name) }}
        className="relative overflow-visible p-4 text-white"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-white/35" />
          <div className="absolute -right-8 -top-10 size-32 rounded-full bg-white/10 blur-2xl" />
        </div>
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold uppercase text-white/70">{row.bank_name}</p>
            <h2 className="mt-1 truncate text-lg font-black leading-tight">{row.card_name}</h2>
            {row.holder_name ? <p className="mt-1 truncate text-xs font-semibold text-white/70">{row.holder_name}</p> : null}
            <CardMaskedNumber cardId={row.id} hidden={balancesHidden} />
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <div className="grid size-10 place-items-center rounded-lg bg-white/15 text-xs font-black uppercase tracking-tight text-white ring-1 ring-white/25">
              {getBankBrand(row.bank_name).code}
            </div>
            <div className="[&>div>button]:border-white/30 [&>div>button]:bg-white/15 [&>div>button]:text-white [&>div>button:hover]:bg-white/25 [&>div>button:hover]:text-white">
              {menu}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-[11px] font-bold uppercase text-white/65">Toplam kart yükü</p>
              {/* Rakam kesin görünür ama uzun süre doğrulanmadıysa güveni düşer. */}
              {debtConfidence.level !== 'exact' ? (
                <span
                  title={debtConfidence.reason}
                  className="rounded-md bg-white/18 px-1.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/25"
                >
                  {debtConfidence.label}
                </span>
              ) : null}
            </div>
            <p className="finance-value mt-1 truncate text-[clamp(1.45rem,6vw,2.15rem)] font-black leading-none">{formatAmount(row.debt_amount)}</p>
          </div>
          <span className="rounded-lg bg-white/14 px-2.5 py-1 text-xs font-black ring-1 ring-white/18">%{usageRate}</span>
        </div>

        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-white/18">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${stats.usageRate}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-white/72">
            <span>Limit {formatAmount(stats.sharedLimit)}</span>
            <span>Kalan {formatAmount(stats.availableLimit)}</span>
          </div>
        </div>
      </div>

      <div className="p-4 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex min-h-6 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-black ring-1 ${status.className}`}>
          {status.label === 'Normal' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {status.label}
        </span>
      </div>

      <LineGroup className="mt-2">
        <CardDatum label="Kullanılabilir" value={formatAmount(stats.availableLimit)} tone="good" />
        <CardDatum label="Dönem içi" value={formatAmount(row.current_period_spending)} />
        <CardDatum label="Açık ekstre" value={formatAmount(displayedOpenStatementAmount)} tone={displayedOpenStatementAmount > 0 ? 'danger' : 'neutral'} />
        <CardDatum label="Gelecek taksit" value={formatAmount(scheduledInstallmentTotal)} />
        <CardDatum label="Son ödeme" value={formatShortDate(dueDate)} tone={displayedOpenStatementAmount > 0 ? 'warning' : 'neutral'} />
      </LineGroup>

      {/* Nötr bilgi, sinyal rengi yok: yüksek tempo her zaman kötü değildir. */}
      {pace ? (
        <p className="mt-2 text-[11px] font-semibold text-ink-muted">
          Dönem temposu: {formatAmount(pace.current)} · geçen dönem aynı gün {formatAmount(pace.previous)}
          {pace.deltaPct !== null && pace.deltaPct !== 0
            ? ` (%${Math.abs(pace.deltaPct)} ${pace.deltaPct > 0 ? 'üzerinde' : 'altında'})`
            : ''}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          onClick={() => onPayDebt(row)}
          disabled={payableDebt <= 0 || openStatements.length > 0}
          title={
            openStatements.length > 0
              ? 'Açık ekstre var — Ekstreler sekmesinden "Ekstreyi öde" ile kapat'
              : payableDebt <= 0
                ? 'Ödenebilir kesinleşmiş borç yok'
                : undefined
          }
          className="finance-touch-target px-3 text-xs"
        >
          <Banknote />
          Borç öde
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={() => onAddExpense(row, 'cash')}
          className="finance-touch-target px-3 text-xs"
        >
          Harcama ekle
        </Button>
      </div>
      {detailsOpen ? (
        <div className="mt-4 rounded-lg border border-line-strong bg-surface-muted/70 p-3 ring-1 ring-line-strong">
          <SectionHeader
            title="Kart detay özeti"
            description="Borç, ekstre, limit, vade ve devam eden taksitleri birlikte oku."
            action={<StatusBadge tone={payableDebt > 0 ? 'warning' : 'good'}>{payableDebt > 0 ? 'Açık ekstre' : 'Temiz'}</StatusBadge>}
          />
          <div className="mt-4 grid grid-cols-2 gap-2 min-[620px]:grid-cols-3">
            <MiniStat label="Ödenebilir" value={formatAmount(payableDebt)} tone={payableDebt > 0 ? 'warning' : 'good'} />
            <MiniStat label="Açık ekstre" value={formatAmount(displayedOpenStatementAmount)} tone={displayedOpenStatementAmount > 0 ? 'danger' : 'neutral'} />
            <MiniStat label="Kalan limit" value={formatAmount(stats.availableLimit)} tone="good" />
            <MiniStat label="Son ödeme" value={formatShortDate(dueDate)} tone={payableDebt > 0 ? 'warning' : 'neutral'} />
            <MiniStat label="Ekstre günü" value={formatMonthlyDay(row.statement_day)} />
            <MiniStat label="Limit kullanımı" value={`%${usageRate}`} tone={usageRate >= 80 ? 'danger' : usageRate >= 55 ? 'warning' : 'good'} />
            <MiniStat label="Devam eden taksit" value={`${installmentCount} işlem`} tone={installmentCount > 0 ? 'warning' : 'neutral'} />
            <MiniStat label="Limit tipi" value={stats.isShared ? 'Ortak limit' : 'Tekil limit'} tone={stats.isShared ? 'info' : 'neutral'} />
            <MiniStat label="İç veri sağlığı" value={`%${consistency.score}`} tone={consistency.score >= 100 ? 'good' : consistency.score >= 75 ? 'warning' : 'danger'} />
          </div>
          <div className="mt-3 rounded-lg bg-raised p-3 ring-1 ring-line-strong">
            <div className="flex items-start gap-2">
              <ShieldCheck size={15} className={consistency.score >= 100 ? 'mt-0.5 text-success' : consistency.score >= 75 ? 'mt-0.5 text-warning' : 'mt-0.5 text-destructive'} />
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-ink-muted">İç veri sağlığı kontrolleri</p>
                <div className="mt-2 grid gap-1 text-xs text-ink-muted">
                  {consistency.checks.map((check) => (
                    <span key={check.label}>{check.ok ? '✓' : '✗'} {check.label}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 min-[760px]:grid-cols-2">
            <div className="rounded-lg bg-raised p-3 ring-1 ring-line-strong">
              <p className="text-xs font-black uppercase text-ink-muted">Devam eden taksitler</p>
              {cardInstallments.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {cardInstallments.slice(0, 3).map((installment) => (
                    <div key={installment.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-page px-3 py-2 text-xs">
                      <span className="min-w-0 truncate font-bold text-ink">{installment.description}</span>
                      <span className="shrink-0 font-black tabular-nums text-ink">
                        {formatAmount(installment.amount)} · {formatDate(installment.due_month)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">Devam eden taksit yok.</p>
              )}
            </div>
            <div className="rounded-lg bg-raised p-3 ring-1 ring-line-strong">
              <p className="text-xs font-black uppercase text-ink-muted">Ekstre geçmişi</p>
              {openStatements.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {openStatements.slice(0, 3).map((statement) => (
                    <div key={statement.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-page px-3 py-2 text-xs">
                      <span className="min-w-0 truncate font-bold text-ink">{statementPeriodLabel(statement)}</span>
                      <span className="shrink-0 font-black tabular-nums text-ink">{formatAmount(statement.statement_debt_amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">Açık ekstre kaydı yok.</p>
              )}
            </div>
          </div>
          <CardAliasPanel card={row} />
          <CardLedgerPanel card={row} onChanged={onChanged} formatAmount={formatAmount} />
        </div>
      ) : null}
      </div>
    </article>
  )
}
