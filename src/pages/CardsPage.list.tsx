import { AlertTriangle, Banknote, Check, CheckCircle2, Copy, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { BankLogo } from '../components/finance/BankLogo'
import { AccountLedgerPanel } from '../components/finance/AccountLedgerPanel'
import { CardAliasPanel } from '../components/finance/CardAliasPanel'
import { CardLedgerPanel } from '../components/finance/CardLedgerPanel'
import { MiniStat, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import { fetchCardAliases } from '../data/repositories/cardAliasesRepo'
import { fetchAccountLedgerEvents } from '../data/repositories/financePanelsRepo'
import type { AccountLedger, Card, CardInstallment, CardStatementArchive } from '../types/database'
import { formatDate, nextMonthlyDate } from '../utils/date'
import { cardPayableDebt } from '../utils/financeSummary'
import { quickCardConsistencyScore } from '../utils/cardConsistency'
import { bankBrandGradient, getBankBrand } from '../utils/bankBranding'
import { buildAccountLedgerBalanceRows } from '../utils/accountLedger'
import { toTL } from '../utils/money'
import {
  activeInstallmentCount,
  bankHueStyle,
  formatIban,
  formatMonthlyDay,
  formatShortDate,
  getCreditCardStatus,
  limitGroupStats,
  statementPeriodLabel,
  visibleOpenStatementAmount,
} from './CardsPage.helpers'
import { CardDatum } from './CardsPage.overview'
import { formatCurrency } from '../utils/formatCurrency'

function AccountRecentTransactions({
  card,
  formatAmount,
}: {
  card: Card
  formatAmount: (value: number | null | undefined) => string
}) {
  const [events, setEvents] = useState<AccountLedger[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchAccountLedgerEvents(card.id).then((result) => {
      if (cancelled) return
      setEvents(result.ok ? result.data.slice(0, 3) : [])
    })
    return () => {
      cancelled = true
    }
  }, [card.id])

  if (!events || events.length === 0) return null

  const rows = buildAccountLedgerBalanceRows(events, card.current_balance)

  return (
    <div className="mt-3 rounded-lg bg-card/70 p-3 ring-1 ring-border/60">
      <p className="text-[11px] font-black uppercase text-muted-foreground">Son 3 hareket</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {rows.map(({ event, balanceAfter }) => {
          const amount = toTL(event.amount_kurus)
          const isInflow = amount >= 0
          return (
            <div key={event.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/45 px-2.5 py-2 text-xs">
              <span className="min-w-0 truncate">
                <span className={isInflow ? 'font-black text-success' : 'font-black text-destructive'}>
                  {isInflow ? 'Giriş' : 'Çıkış'}
                </span>
                <span className="ml-2 text-muted-foreground">{formatDate(event.occurred_at.slice(0, 10))}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={isInflow ? 'font-black text-success' : 'font-black text-destructive'}>
                  {amount > 0 ? '+' : ''}{formatAmount(amount)}
                </span>
                <span className="ml-2 text-muted-foreground">Sonrası {formatAmount(balanceAfter)}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CardMaskedNumber({ cardId, hidden }: { cardId: string; hidden: boolean }) {
  const [digits, setDigits] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchCardAliases(cardId).then((result) => {
      if (cancelled) return
      setDigits(result.ok ? (result.data[0]?.last_four_digits ?? null) : null)
    })
    return () => {
      cancelled = true
    }
  }, [cardId])

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
        className="finance-panel min-w-0 rounded-lg p-4 ring-1 ring-[hsl(var(--bank-hue)_42%_82%/0.55)] dark:ring-[hsl(var(--bank-hue)_40%_42%/0.45)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <BankLogo bankName={row.bank_name} size="md" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-black text-foreground">{row.card_name}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">{row.bank_name} · banka hesabı</p>
            </div>
          </div>
          {menu}
        </div>

        <div className="mt-4 rounded-lg bg-[hsl(var(--bank-hue)_58%_97%)] p-3 ring-1 ring-[hsl(var(--bank-hue)_50%_84%/0.7)] dark:bg-[hsl(var(--bank-hue)_40%_16%)] dark:ring-[hsl(var(--bank-hue)_36%_34%)]">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">Kullanılabilir bakiye</p>
          <p className="finance-value mt-1 truncate text-[clamp(1.35rem,6vw,2rem)] font-black leading-none text-foreground">
            {formatAmount(row.current_balance)}
          </p>
        </div>

        {row.iban ? (
          <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 ring-1 ring-border/60">
            <p className="text-[11px] font-bold uppercase text-muted-foreground">IBAN</p>
            <button
              type="button"
              onClick={handleCopyIban}
              className="mt-1 flex w-full min-w-0 items-center justify-between gap-2 rounded-md text-left font-mono text-xs font-black tabular-nums text-foreground transition hover:text-primary"
            >
              <span className="min-w-0 truncate">{balancesHidden ? '••••' : formatIban(row.iban)}</span>
              {ibanCopied ? <Check size={14} className="shrink-0 text-success" /> : <Copy size={14} className="shrink-0 text-muted-foreground" />}
            </button>
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <CardDatum label="Tür" value="Banka hesabı" />
          <CardDatum label="Not" value={row.note || '-'} />
        </div>

        <AccountRecentTransactions card={row} formatAmount={formatAmount} />

        {ledgerOpen ? <AccountLedgerPanel card={row} onChanged={onChanged} formatAmount={formatAmount} /> : null}
        {rowActions}
      </article>
    )
  }

  const stats = limitGroupStats(row, rows)
  const usageRate = Math.round(stats.usageRate)
  const dueDate = nextMonthlyDate(row.due_day)
  const status = getCreditCardStatus(row, stats.usageRate)
  const displayedOpenStatementAmount = visibleOpenStatementAmount(row, statements)
  const installmentCount = activeInstallmentCount(row, installments)
  const payableDebt = cardPayableDebt(row)
  const openStatements = statements.filter((statement) => statement.card_id === row.id && statement.status === 'open')
  const cardInstallments = installments
    .filter((installment) => installment.card_id === row.id && installment.status !== 'paid')
    .sort((left, right) => left.due_month.localeCompare(right.due_month))
  const consistency = quickCardConsistencyScore(row, installments)

  return (
    <article
      style={bankHueStyle(row.bank_name, rows)}
      className="finance-panel min-w-0 rounded-lg bg-card/96 p-4 ring-1 ring-[hsl(var(--bank-hue)_42%_82%/0.55)] dark:ring-[hsl(var(--bank-hue)_40%_42%/0.45)]"
    >
      <div
        style={{ backgroundImage: bankBrandGradient(row.bank_name) }}
        className="relative rounded-lg p-4 text-white shadow-sm"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
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
            <p className="text-[11px] font-bold uppercase text-white/65">Güncel borç</p>
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex min-h-6 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-black ring-1 ${status.className}`}>
          {status.label === 'Normal' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {status.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <CardDatum label="Kullanılabilir" value={formatAmount(stats.availableLimit)} tone="good" />
        <CardDatum label="Dönem borcu" value={formatAmount(row.current_period_spending)} />
        <CardDatum label="Açık ekstre" value={formatAmount(displayedOpenStatementAmount)} tone={displayedOpenStatementAmount > 0 ? 'danger' : 'neutral'} />
        <CardDatum label="Son ödeme" value={formatShortDate(dueDate)} tone={payableDebt > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onPayDebt(row)}
          disabled={payableDebt <= 0 || openStatements.length > 0}
          title={
            openStatements.length > 0
              ? 'Açık ekstre var — Ekstreler sekmesinden "Ekstreyi öde" ile kapat'
              : payableDebt <= 0
                ? 'Ödenebilir kesinleşmiş borç yok'
                : undefined
          }
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-55"
        >
          <Banknote size={15} />
          Borç öde
        </button>
        <button
          type="button"
          onClick={() => onAddExpense(row, 'cash')}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Harcama ekle
        </button>
      </div>
      {detailsOpen ? (
        <div className="mt-4 rounded-lg border border-border/80 bg-surface-muted/70 p-3 ring-1 ring-border/60">
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
            <MiniStat label="Tutarlılık" value={`%${consistency.score}`} tone={consistency.score >= 100 ? 'good' : consistency.score >= 75 ? 'warning' : 'danger'} />
          </div>
          <div className="mt-3 rounded-lg bg-card/80 p-3 ring-1 ring-border/70">
            <div className="flex items-start gap-2">
              <ShieldCheck size={15} className={consistency.score >= 100 ? 'mt-0.5 text-success' : consistency.score >= 75 ? 'mt-0.5 text-warning' : 'mt-0.5 text-destructive'} />
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-muted-foreground">Tutarlılık kontrolleri</p>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  {consistency.checks.map((check) => (
                    <span key={check.label}>{check.ok ? '✓' : '✗'} {check.label}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 min-[760px]:grid-cols-2">
            <div className="rounded-lg bg-card/80 p-3 ring-1 ring-border/70">
              <p className="text-xs font-black uppercase text-muted-foreground">Devam eden taksitler</p>
              {cardInstallments.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {cardInstallments.slice(0, 3).map((installment) => (
                    <div key={installment.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/55 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate font-bold text-foreground">{installment.description}</span>
                      <span className="shrink-0 font-black tabular-nums text-foreground">
                        {formatAmount(installment.amount)} · {formatDate(installment.due_month)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Devam eden taksit yok.</p>
              )}
            </div>
            <div className="rounded-lg bg-card/80 p-3 ring-1 ring-border/70">
              <p className="text-xs font-black uppercase text-muted-foreground">Ekstre geçmişi</p>
              {openStatements.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {openStatements.slice(0, 3).map((statement) => (
                    <div key={statement.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/55 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate font-bold text-foreground">{statementPeriodLabel(statement)}</span>
                      <span className="shrink-0 font-black tabular-nums text-foreground">{formatAmount(statement.statement_debt_amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Açık ekstre kaydı yok.</p>
              )}
            </div>
          </div>
          <CardAliasPanel card={row} />
          <CardLedgerPanel card={row} onChanged={onChanged} formatAmount={formatAmount} />
        </div>
      ) : null}
    </article>
  )
}
