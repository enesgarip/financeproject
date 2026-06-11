import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock3,
  CreditCard as CreditCardIcon,
  Image as ImageIcon,
  LayoutGrid,
  ReceiptText,
  ScanLine,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BankLogo } from '../components/finance/BankLogo'
import { CardLedgerPanel } from '../components/finance/CardLedgerPanel'
import { CategoryPicker } from '../components/finance/CategoryPicker'
import { AmountDisplay, FinancePanel, MiniStat, ProgressStrip, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import { InstallmentPlanner } from '../components/finance/InstallmentPlanner'
import { MoneyInput } from '../components/finance/MoneyInput'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../components/ui/help-tooltip'
import { Progress } from '../components/ui/progress'
import { invalidateCategoryMemory, useCategoryMemory } from '../hooks/useCategoryMemory'
import { supabase } from '../lib/supabase'
import type { Card, CardExpense, CardExpenseStatus, CardInstallment, CardStatementArchive, InsertFor } from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { getCardStatementPeriod } from '../utils/cardStatement'
import { dateInputValue, daysUntil, formatDate, nextMonthlyDate } from '../utils/date'
import { cardPayableDebt, cardProvisionAmount } from '../utils/financeSummary'
import { roundTL } from '../utils/money'
import { getLastUsed, setLastUsed } from '../utils/lastUsed'
import { bankBrandGradient, getBankBrand } from '../utils/bankBranding'
import { cn, openNativePicker } from '../lib/utils'
import { bankHueStyle, isSchemaCacheError, limitGroupKey, limitGroupStats, statementPeriodLabel } from './CardsPage.helpers'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { addTransactionHistory } from '../utils/history'
import { parseReceiptImage } from '../lib/receiptParseClient'
import { canCutCurrentStatement } from '../utils/statementCycle'

export type CardSection = 'ozet' | 'kartlar' | 'islemler' | 'ekstreler'

const cardSections = [
  { id: 'ozet', label: 'Özet', icon: LayoutGrid },
  { id: 'kartlar', label: 'Kartlar', icon: CreditCardIcon },
  { id: 'islemler', label: 'İşlemler', icon: ReceiptText },
  { id: 'ekstreler', label: 'Ekstreler', icon: CalendarClock },
] as const satisfies readonly { id: CardSection; label: string; icon: typeof LayoutGrid }[]

export function CardSectionNav({
  section,
  onSelect,
  counts,
}: {
  section: CardSection
  onSelect: (next: CardSection) => void
  counts: Partial<Record<CardSection, number>>
}) {
  return (
    <div className="finance-command-surface -mx-1 flex gap-1.5 overflow-x-auto rounded-lg p-1.5 finance-scrollbar">
      {cardSections.map((item) => {
        const isActive = item.id === section
        const count = counts[item.id]
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-pressed={isActive}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1.5 py-2 text-[11px] font-black leading-tight transition',
              'min-[560px]:flex-row min-[560px]:gap-1.5 min-[560px]:px-3 min-[560px]:text-xs',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
          >
            <item.icon size={16} strokeWidth={2.3} className="shrink-0" />
            <span className="flex items-center gap-1 whitespace-nowrap">
              {item.label}
              {count ? (
                <span
                  className={cn(
                    'grid min-w-4 place-items-center rounded-full px-1 text-[9px] font-black tabular-nums min-[560px]:text-[10px]',
                    isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/12 text-primary',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const cardHelp = {
  summary: {
    calculation: 'Kredi kartı borçları, dönem içi harcamalar ve provizyonlar birlikte okunur; banka kartları ayrıca hesap bakiyesi olarak gösterilir.',
    importance: 'Kart tarafındaki toplam yükü ve eldeki hesap bakiyesini aynı anda görmeni sağlar.',
    source: 'Kartlar, kart harcamaları ve provizyon kayıtları.',
  },
  totalDebt: {
    calculation: 'Ekstre borcu, dönem içi kesinleşen harcama ve provizyon toplamıdır.',
    importance: 'Kart limitini kullanan toplam yükü gösterir.',
    source: 'Kart kaydındaki borç kırılımı ve kart harcama kayıtları.',
  },
  statementDebt: {
    calculation: 'Kesilmiş ekstreye düşmüş, artık ödenebilir olan kart borcudur.',
    importance: 'Son ödeme tarihine kadar ödenmesi gereken gerçek tutarı ayırır.',
    source: 'Kart kaydındaki ekstre borcu ve ekstre kesme işlemleri.',
  },
  currentPeriod: {
    calculation: 'Bu dönem kesinleşmiş ama henüz ekstreye aktarılmamış harcamalar toplanır.',
    importance: 'Bir sonraki ekstreye girecek yükü önceden görmeni sağlar.',
    source: 'Kesinleşmiş kart harcamaları ve dönem bilgileri.',
  },
  provision: {
    calculation: 'Provizyonda bekleyen kart işlemleri toplanır; henüz ödenebilir borç sayılmaz.',
    importance: 'Limitten düşen ama kesinleşmeden ödenmemesi gereken tutarı ayrı tutar.',
    source: 'Provizyon durumundaki kart harcama kayıtları.',
  },
  availableLimit: {
    calculation: 'Kredi limiti veya ortak limit grubundan toplam kart borcu düşülür.',
    importance: 'Yeni harcama için kalan gerçek alanı gösterir.',
    source: 'Kart limiti, ortak limit grubu ve toplam borç kayıtları.',
  },
  limit: {
    calculation: 'Ortak limit grubunda en yüksek limit alınır; tekil kartta kartın kendi limiti kullanılır.',
    importance: 'Aynı limiti paylaşan kartlarda limiti iki kez saymayı önler.',
    source: 'Kart limiti ve ortak limit grubu alanları.',
  },
  usage: {
    calculation: 'Toplam borç, kullanılabilir kredi limitine bölünerek yüzdeye çevrilir.',
    importance: 'Limit doluluğunu ve riskli kullanım seviyesini hızlı gösterir.',
    source: 'Kart borcu, provizyon ve limit kayıtları.',
  },
  cashBalance: {
    calculation: 'Banka kartı türündeki hesapların güncel bakiyeleri toplanır.',
    importance: 'Kart borçlarına karşı eldeki nakit hesabı birlikte görmeyi sağlar.',
    source: 'Banka kartı / hesap bakiyesi kayıtları.',
  },
  provisionsPanel: {
    calculation: 'Provizyon durumundaki kart harcamaları listelenir ve toplamı gösterilir.',
    importance: 'Kesinleşince dönem içine geçecek, iptalde limitten çıkacak işlemleri kontrol eder.',
    source: 'Kart harcama kayıtlarının provizyon durumu.',
  },
} satisfies Record<string, HelpTooltipContent>

type LimitGroupSummary = {
  key: string
  label: string
  bankName: string
  cards: Card[]
  limit: number
  debt: number
  statementDebt: number
  currentPeriod: number
  provision: number
  available: number
  usageRate: number
}

function buildLimitGroupSummaries(rows: Card[]): LimitGroupSummary[] {
  const groups = new Map<string, Card[]>()

  for (const card of rows.filter((row) => row.card_type === 'kredi_karti')) {
    const key = limitGroupKey(card)
    groups.set(key, [...(groups.get(key) ?? []), card])
  }

  return Array.from(groups, ([key, cards]) => {
    const limit = Math.max(...cards.map((card) => card.credit_limit), 0)
    const debt = cards.reduce((total, card) => total + card.debt_amount, 0)
    const statementDebt = cards.reduce((total, card) => total + card.statement_debt_amount, 0)
    const currentPeriod = cards.reduce((total, card) => total + card.current_period_spending, 0)
    const provision = cards.reduce((total, card) => total + cardProvisionAmount(card), 0)
    const label = cards.find((card) => card.limit_group_name?.trim())?.limit_group_name?.trim() || cards[0]?.card_name || 'Kredi kartı'

    return {
      key,
      label,
      bankName: cards[0]?.bank_name ?? '',
      cards,
      limit,
      debt,
      statementDebt,
      currentPeriod,
      provision,
      available: Math.max(0, limit - debt),
      usageRate: limit > 0 ? Math.min(100, (debt / limit) * 100) : 0,
    }
  }).sort((a, b) => b.debt - a.debt)
}

export function CreditCardOverview({ rows }: { rows: Card[] }) {
  const groups = buildLimitGroupSummaries(rows)
  const bankCards = rows.filter((row) => row.card_type === 'banka_karti')
  if (groups.length === 0 && bankCards.length === 0) return null

  const totalLimit = groups.reduce((total, group) => total + group.limit, 0)
  const totalDebt = groups.reduce((total, group) => total + group.debt, 0)
  const totalStatementDebt = groups.reduce((total, group) => total + group.statementDebt, 0)
  const totalCurrentPeriod = groups.reduce((total, group) => total + group.currentPeriod, 0)
  const totalProvision = groups.reduce((total, group) => total + group.provision, 0)
  const totalAvailable = Math.max(0, totalLimit - totalDebt)
  const totalUsageRate = totalLimit > 0 ? Math.min(100, (totalDebt / totalLimit) * 100) : 0
  const cashBalance = bankCards.reduce((total, card) => total + card.current_balance, 0)

  return (
    <div className="flex flex-col gap-3">
      <FinancePanel tone={totalUsageRate >= 80 ? 'danger' : totalUsageRate >= 55 ? 'warning' : 'premium'} className="p-4 sm:p-5">
        <SectionHeader
          title="Kart özeti"
          description="Toplam borç, açık ekstre, provizyon ve kullanılabilir limit."
          action={
            <div className="inline-flex items-center gap-1 text-muted-foreground">
              <HelpTooltip title="Kart özeti" content={cardHelp.summary} />
              <StatusBadge tone={totalUsageRate >= 80 ? 'danger' : totalUsageRate >= 55 ? 'warning' : 'good'}>%{Math.round(totalUsageRate)}</StatusBadge>
            </div>
          }
        />
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-end">
          <div className="min-w-0">
            <AmountDisplay label="Toplam kart borcu" value={formatCurrency(totalDebt)} tone={totalDebt > 0 ? 'warning' : 'good'} size="lg" />
            <div className="mt-4">
              <ProgressStrip label="Limit kullanımı" value={totalUsageRate} tone={totalUsageRate >= 80 ? 'danger' : totalUsageRate >= 55 ? 'warning' : 'good'} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-3">
            <MiniStat label="Ekstre borcu" value={formatCurrency(totalStatementDebt)} tone={totalStatementDebt > 0 ? 'warning' : 'good'} />
            <MiniStat label="Dönem içi" value={formatCurrency(totalCurrentPeriod)} tone="info" />
            <MiniStat label="Provizyon" value={formatCurrency(totalProvision)} tone={totalProvision > 0 ? 'warning' : 'neutral'} />
            <MiniStat label="Kalan limit" value={formatCurrency(totalAvailable)} tone="good" />
            <MiniStat label="Limit" value={formatCurrency(totalLimit)} tone="neutral" />
            <MiniStat label="Hesap bakiyesi" value={formatCurrency(cashBalance)} tone="premium" />
          </div>
        </div>
      </FinancePanel>

      {groups.length > 0 ? (
        <div className="flex snap-x gap-3 overflow-x-auto pb-1">
          {groups.map((group) => (
            <SurfaceCard key={group.key} className="min-w-[86%] snap-start border-border/70 shadow-[var(--shadow-card)] min-[520px]:min-w-[48%]">
              <CardHeader className="pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <BankLogo bankName={group.bankName} size="sm" />
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{group.label}</CardTitle>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{group.bankName}</p>
                    </div>
                  </div>
                  <Badge variant="secondary">{group.cards.length} kart</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-1">
                <div className="grid grid-cols-2 gap-2 text-xs min-[460px]:grid-cols-4">
                  <OverviewStat label="Toplam" value={formatCurrency(group.debt)} help={cardHelp.totalDebt} />
                  <OverviewStat label="Ekstre" value={formatCurrency(group.statementDebt)} help={cardHelp.statementDebt} />
                  <OverviewStat label="Dönem içi" value={formatCurrency(group.currentPeriod)} help={cardHelp.currentPeriod} />
                  <OverviewStat label="Provizyon" value={formatCurrency(group.provision)} help={cardHelp.provision} />
                </div>
                <Progress value={group.usageRate} className="h-1.5" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Limit {formatCurrency(group.limit)}</span>
                  <span>Kalan {formatCurrency(group.available)}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {group.cards.map((card) => (
                    <div key={card.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/55 px-2.5 py-2 text-xs">
                      <span className="min-w-0 truncate font-semibold text-foreground">
                        {card.holder_name || card.card_name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatCurrency(card.debt_amount)}
                        {cardProvisionAmount(card) > 0 ? ` · prov. ${formatCurrency(cardProvisionAmount(card))}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </SurfaceCard>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function AccountHubPanel({
  rows,
  onOpenTransfer,
}: {
  rows: Card[]
  onOpenTransfer: (source: Card) => void
}) {
  const accounts = rows.filter((row) => row.card_type === 'banka_karti')
  const creditCards = rows.filter((row) => row.card_type === 'kredi_karti')
  if (accounts.length === 0 && creditCards.length === 0) return null

  const accountBalance = accounts.reduce((total, account) => total + account.current_balance, 0)
  const cardDebt = creditCards.reduce((total, card) => total + card.debt_amount, 0)
  const payableCardDebt = creditCards.reduce((total, card) => total + cardPayableDebt(card), 0)
  const banks = Array.from(
    accounts.reduce((map, account) => {
      const current = map.get(account.bank_name) ?? { balance: 0, count: 0 }
      map.set(account.bank_name, {
        balance: current.balance + account.current_balance,
        count: current.count + 1,
      })
      return map
    }, new Map<string, { balance: number; count: number }>()),
  ).sort((left, right) => right[1].balance - left[1].balance)
  const canTransfer = accounts.length > 1

  return (
    <SurfaceCard id="hesap-merkezi" className="border-0 shadow-sm ring-1 ring-primary/18">
      <CardHeader className="pb-0">
        <div className="min-w-0">
          <CardTitle className="text-base">Hesap merkezi</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Banka hesapları, kredi kartı yükü ve transferler tek yerde.</p>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-3">
        <div className="grid grid-cols-2 gap-2 min-[620px]:grid-cols-4">
          <OverviewStat label="Hesap bakiyesi" value={formatCurrency(accountBalance)} help={cardHelp.cashBalance} />
          <OverviewStat label="Kredi kartı borcu" value={formatCurrency(cardDebt)} help={cardHelp.totalDebt} />
          <OverviewStat label="Ödenebilir borç" value={formatCurrency(payableCardDebt)} help={cardHelp.statementDebt} />
          <OverviewStat label="Banka sayısı" value={String(banks.length)} />
        </div>

        {accounts.length > 0 ? (
          <div className="grid gap-2 min-[760px]:grid-cols-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/55 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <BankLogo bankName={account.bank_name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{account.card_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{account.bank_name}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-extrabold tabular-nums text-foreground">{formatCurrency(account.current_balance)}</span>
                  <button
                    type="button"
                    onClick={() => onOpenTransfer(account)}
                    disabled={!canTransfer}
                    className="grid size-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-45"
                    aria-label={`${account.card_name} hesabından transfer yap`}
                  >
                    <ArrowRightLeft size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-muted/45 p-3 text-sm text-muted-foreground">Transfer için önce banka kartı türünde en az iki hesap ekle.</p>
        )}

        {banks.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {banks.map(([bankName, bank]) => (
              <Badge key={bankName} variant="outline">
                {bankName} · {formatCurrency(bank.balance)}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </SurfaceCard>
  )
}

function OverviewStat({ label, value, help }: { label: string; value: string; help?: HelpTooltipContent }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1">
        <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
        {help ? <HelpTooltip title={label} content={help} /> : null}
      </div>
      <p className="mt-1 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

type CreditCardStatus = {
  label: string
  description: string
  className: string
}

function getCreditCardStatus(card: Card, usageRate: number): CreditCardStatus {
  const payableDebt = cardPayableDebt(card)
  const dueDate = nextMonthlyDate(card.due_day)
  const remainingDays = daysUntil(dueDate)

  if (payableDebt > 0 && remainingDays !== null && remainingDays < 0) {
    return {
      label: 'Gecikmiş',
      description: `${Math.abs(remainingDays)} gün geçti`,
      className: 'bg-destructive/12 text-destructive ring-destructive/20',
    }
  }

  if (payableDebt > 0 && remainingDays !== null && remainingDays <= 5) {
    return {
      label: 'Son ödeme yaklaşıyor',
      description: remainingDays === 0 ? 'Bugün' : `${remainingDays} gün kaldı`,
      className: 'bg-warning/12 text-warning ring-warning/20',
    }
  }

  if (usageRate >= 80) {
    return {
      label: 'Limit kullanımı yüksek',
      description: `%${Math.round(usageRate)} kullanım`,
      className: 'bg-warning/12 text-warning ring-warning/20',
    }
  }

  return {
    label: 'Normal',
    description: payableDebt > 0 ? 'Takipte' : 'Ödenebilir borç yok',
    className: 'bg-success/12 text-success ring-success/20',
  }
}

function formatMonthlyDay(day: number | null | undefined) {
  return day ? `Her ay ${day}` : '-'
}

function formatShortDate(value: Date | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' }).format(value)
}

function activeInstallmentCount(card: Card, installments: CardInstallment[]) {
  return installments.filter((installment) => installment.card_id === card.id && installment.status !== 'paid').length
}

function openStatementAmount(card: Card, statements: CardStatementArchive[]) {
  return statements
    .filter((statement) => statement.card_id === card.id && statement.status === 'open')
    .reduce((total, statement) => total + statement.statement_debt_amount, 0)
}

function CardDatum({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warning' | 'danger' }) {
  const valueClass = {
    neutral: 'text-foreground',
    good: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  }[tone]

  return (
    <div className="finance-field min-w-0 rounded-lg px-3 py-2.5">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`finance-value mt-1 truncate text-sm font-black leading-tight ${valueClass}`}>{value}</p>
    </div>
  )
}

export function CreditAccountListCard({
  row,
  rows,
  statements,
  installments,
  menu,
  rowActions,
  onTransfer,
  onAddExpense,
  onImportStatement,
  onChanged,
}: {
  row: Card
  rows: Card[]
  statements: CardStatementArchive[]
  installments: CardInstallment[]
  menu: React.ReactNode
  rowActions: React.ReactNode
  onTransfer: (source: Card) => void
  onAddExpense: (card: Card, mode: 'cash' | 'installment') => void
  onImportStatement: (card: Card) => void
  onChanged?: () => void | Promise<void>
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (row.card_type === 'banka_karti') {
    const accountCount = rows.filter((card) => card.card_type === 'banka_karti').length

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
            {formatCurrency(row.current_balance)}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <CardDatum label="Tür" value="Banka hesabı" />
          <CardDatum label="Not" value={row.note || '-'} />
        </div>

        <button
          type="button"
          onClick={() => onTransfer(row)}
          disabled={accountCount < 2}
          className="finance-touch-target mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-55"
        >
          <ArrowRightLeft size={15} />
          Transfer yap
        </button>
        {rowActions}
      </article>
    )
  }

  const stats = limitGroupStats(row, rows)
  const usageRate = Math.round(stats.usageRate)
  const dueDate = nextMonthlyDate(row.due_day)
  const status = getCreditCardStatus(row, stats.usageRate)
  const openAmount = openStatementAmount(row, statements)
  const installmentCount = activeInstallmentCount(row, installments)
  const payableDebt = cardPayableDebt(row)
  const openStatements = statements.filter((statement) => statement.card_id === row.id && statement.status === 'open')
  const cardInstallments = installments
    .filter((installment) => installment.card_id === row.id && installment.status !== 'paid')
    .sort((left, right) => left.due_month.localeCompare(right.due_month))

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
            <p className="finance-value mt-1 truncate text-[clamp(1.45rem,6vw,2.15rem)] font-black leading-none">{formatCurrency(row.debt_amount)}</p>
          </div>
          <span className="rounded-lg bg-white/14 px-2.5 py-1 text-xs font-black ring-1 ring-white/18">%{usageRate}</span>
        </div>

        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-white/18">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${stats.usageRate}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-white/72">
            <span>Limit {formatCurrency(stats.sharedLimit)}</span>
            <span>Kalan {formatCurrency(stats.availableLimit)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex min-h-6 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-black ring-1 ${status.className}`}>
          {status.label === 'Normal' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {status.label}
        </span>
        <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{status.description}</span>
        {stats.isShared ? <span className="rounded-lg bg-info/10 px-2.5 py-1 text-xs font-bold text-info">Ortak limit</span> : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <CardDatum label="Kullanılabilir" value={formatCurrency(stats.availableLimit)} tone="good" />
        <CardDatum label="Dönem borcu" value={formatCurrency(row.current_period_spending)} />
        <CardDatum label="Açık ekstre" value={formatCurrency(openAmount || row.statement_debt_amount)} tone={openAmount + row.statement_debt_amount > 0 ? 'danger' : 'neutral'} />
        <CardDatum label="Devam eden taksit" value={`${installmentCount} işlem`} tone={installmentCount > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/55 px-3 py-2">
          <p className="font-bold uppercase text-muted-foreground">Ekstre</p>
          <p className="mt-1 font-extrabold text-foreground">{formatMonthlyDay(row.statement_day)}</p>
        </div>
        <div className="rounded-lg bg-muted/55 px-3 py-2">
          <p className="font-bold uppercase text-muted-foreground">Son ödeme</p>
          <p className="mt-1 font-extrabold text-foreground">{formatShortDate(dueDate)}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 min-[520px]:grid-cols-4">
        <button
          type="button"
          onClick={() => setDetailsOpen((current) => !current)}
          aria-expanded={detailsOpen}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Detay
        </button>
        <button
          type="button"
          onClick={() => onAddExpense(row, 'cash')}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Harcama ekle
        </button>
        <button
          type="button"
          onClick={() => onImportStatement(row)}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Ekstre içe aktar
        </button>
        <button
          type="button"
          onClick={() => onAddExpense(row, 'installment')}
          className="finance-touch-target inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Taksit ekle
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
            <MiniStat label="Ödenebilir" value={formatCurrency(payableDebt)} tone={payableDebt > 0 ? 'warning' : 'good'} />
            <MiniStat label="Açık ekstre" value={formatCurrency(openAmount || row.statement_debt_amount)} tone={openAmount + row.statement_debt_amount > 0 ? 'danger' : 'neutral'} />
            <MiniStat label="Kalan limit" value={formatCurrency(stats.availableLimit)} tone="good" />
            <MiniStat label="Son ödeme" value={formatShortDate(dueDate)} tone={payableDebt > 0 ? 'warning' : 'neutral'} />
            <MiniStat label="Ekstre günü" value={formatMonthlyDay(row.statement_day)} />
            <MiniStat label="Limit kullanımı" value={`%${usageRate}`} tone={usageRate >= 80 ? 'danger' : usageRate >= 55 ? 'warning' : 'good'} />
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
                        {formatCurrency(installment.amount)} · {formatMonthLabel(installment.due_month.slice(0, 7))}
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
                      <span className="shrink-0 font-black tabular-nums text-foreground">{formatCurrency(statement.statement_debt_amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Açık ekstre kaydı yok.</p>
              )}
            </div>
          </div>
          <CardLedgerPanel card={row} onChanged={onChanged} />
        </div>
      ) : null}
    </article>
  )
}

function cardOptionLabel(card: Card) {
  const owner = card.holder_name ? ` · ${card.holder_name}` : ''
  return `${card.bank_name} · ${card.card_name}${owner}`
}

function monthInputValue(value = new Date()) {
  return value.toLocaleDateString('sv-SE').slice(0, 7)
}

function isMonthValue(month: string) {
  return /^\d{4}-\d{2}$/.test(month)
}

function monthDateValue(month: string) {
  const safeMonth = isMonthValue(month) ? month : monthInputValue()
  return `${safeMonth}-01`
}

function addMonthsToMonth(month: string, months: number) {
  const [year, monthIndex] = monthDateValue(month).slice(0, 7).split('-').map(Number)
  if (!year || !monthIndex) return monthDateValue(monthInputValue())

  return new Date(year, monthIndex - 1 + months, 1).toLocaleDateString('sv-SE')
}

function moneyShare(amount: number, pieces: number) {
  if (amount <= 0) return 0
  return roundTL(amount / Math.max(1, pieces))
}

function formatMonthLabel(month: string) {
  if (!isMonthValue(month)) return '-'
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${monthDateValue(month)}T00:00:00`))
}

function parseInstallmentNumber(value: string, fallback: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function QuickExpensePanel({
  rows,
  reload,
  setError,
  focus,
}: {
  rows: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
  focus?: { cardId: string; mode: 'cash' | 'installment'; nonce: number } | null
}) {
  const [cardId, setCardId] = useState(() => getLastUsed('expenseCard'))
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [spentAt, setSpentAt] = useState(dateInputValue(new Date()))
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diğer')
  const [paymentMode, setPaymentMode] = useState<'cash' | 'installment'>('cash')
  const [installmentCount, setInstallmentCount] = useState('1')
  const [expenseStatus, setExpenseStatus] = useState<CardExpenseStatus>('posted')
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const categoryMemory = useCategoryMemory()
  const cards = useMemo(() => rows.filter((row) => row.card_type === 'kredi_karti' || row.card_type === 'banka_karti'), [rows])
  const activeCardId = cards.some((card) => card.id === cardId) ? cardId : (cards[0]?.id ?? '')
  const selectedCard = cards.find((card) => card.id === activeCardId)
  const canUseInstallments = selectedCard?.card_type === 'kredi_karti'
  const parsedAmount = parseNumber(amount)
  const parsedInstallmentCount = canUseInstallments && paymentMode === 'installment' ? Math.max(2, Math.min(36, Number(installmentCount) || 2)) : 1
  const trimmedDescription = description.trim()
  const statementPreview = useMemo(() => getCardStatementPeriod(selectedCard, spentAt), [selectedCard, spentAt])
  const firstPeriodAmount = parsedInstallmentCount > 1 ? moneyShare(parsedAmount, parsedInstallmentCount) : parsedAmount
  const debitPreview = Math.max(0, (selectedCard?.current_balance ?? 0) - parsedAmount)
  const isProvision = expenseStatus === 'provision'
  const canSubmitQuickExpense = Boolean(selectedCard) && parsedAmount > 0 && trimmedDescription.length > 0 && !saving

  // "Harcama ekle / Taksit ekle" kısayolundan gelen kartı ve modu önceden seç.
  const focusNonce = focus?.nonce
  useEffect(() => {
    if (!focus) return
    const targetCard = cards.find((card) => card.id === focus.cardId)
    if (!targetCard) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCardId(targetCard.id)
    setLastUsed('expenseCard', targetCard.id)
    if (focus.mode === 'installment' && targetCard.card_type === 'kredi_karti') {
      setPaymentMode('installment')
      setInstallmentCount((current) => (Number(current) < 2 ? '2' : current))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  async function handleScanFile(file: File) {
    setScanning(true)
    setLocalError('')
    try {
      const result = await parseReceiptImage(file)
      setAmount(String(result.amount))
      if (result.merchant) setDescription(result.merchant)
      if (result.category) setCategory(result.category)
      if (result.date) setSpentAt(result.date)
    } catch (scanError) {
      setLocalError(scanError instanceof Error ? scanError.message : 'Fiş okunamadı, tekrar dene.')
    } finally {
      setScanning(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedCard) {
      setLocalError('Kart seçmelisin.')
      return
    }
    if (parsedAmount <= 0) {
      setLocalError('Tutar 0 dan büyük olmalı.')
      return
    }
    if (!trimmedDescription) {
      setLocalError('Açıklama yazmalısın.')
      return
    }
    setSaving(true)
    setLocalError('')
    setError('')
    const { error } = await supabase.rpc('add_card_expense', {
      p_card_id: selectedCard.id,
      p_amount: parsedAmount,
      p_description: trimmedDescription,
      p_spent_at: spentAt,
      p_category: category,
      p_installment_count: parsedInstallmentCount,
      p_status: expenseStatus,
    })

    let submitError = error
    if (submitError && isSchemaCacheError(submitError) && parsedInstallmentCount === 1 && expenseStatus === 'posted') {
      const { error: legacyError } = await supabase.rpc('add_card_expense', {
        p_card_id: selectedCard.id,
        p_amount: parsedAmount,
        p_description: trimmedDescription,
        p_spent_at: spentAt,
      })
      submitError = legacyError
    }

    setSaving(false)
    if (submitError) {
      setLocalError(
        isSchemaCacheError(submitError)
          ? 'Provizyon/taksit altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
          : submitError.message,
      )
      return
    }

    invalidateCategoryMemory()
    setLastUsed('expenseCard', selectedCard.id)
    setCardId(selectedCard.id)
    setAmount('')
    setDescription('')
    setSpentAt(dateInputValue(new Date()))
    setCategory(expenseCategoryOptions[0]?.value ?? 'Diğer')
    setPaymentMode('cash')
    setInstallmentCount('1')
    setExpenseStatus('posted')
    await reload()
  }

  if (cards.length === 0) return null

  return (
    <SurfaceCard id="hizli-harcama" className="border-success/20 shadow-[var(--shadow-card)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Hızlı harcama</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Kart, TL tutar ve açıklama yeterli.</p>
          </div>
          {selectedCard ? (
            <Badge variant={selectedCard.card_type === 'kredi_karti' ? 'secondary' : 'outline'}>
              {selectedCard.card_type === 'kredi_karti'
                ? cardProvisionAmount(selectedCard) > 0
                  ? `Provizyon ${formatCurrency(cardProvisionAmount(selectedCard))}`
                  : `Toplam ${formatCurrency(selectedCard.debt_amount)}`
                : `Bakiye ${formatCurrency(selectedCard.current_balance)}`}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = '' // allow re-selecting the same file
              if (file) void handleScanFile(file)
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = '' // allow re-selecting the same file
              if (file) void handleScanFile(file)
            }}
          />
          {scanning ? (
            <div className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary">
              <ScanLine size={16} />
              Fiş okunuyor...
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
              >
                <Camera size={16} />
                Kamerayla çek
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
              >
                <ImageIcon size={16} />
                Galeriden seç
              </button>
            </div>
          )}
          <label className="block text-sm font-semibold text-foreground">
            Kart
            <select
              value={activeCardId}
              onChange={(event) => {
                const nextCardId = event.target.value
                setCardId(nextCardId)
                setLastUsed('expenseCard', nextCardId)
                setPaymentMode('cash')
                setLocalError('')
              }}
              className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              required
            >
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {cardOptionLabel(card)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] gap-2.5">
            <MoneyInput
              label="TL"
              value={amount}
              onValueChange={(nextAmount) => {
                setAmount(nextAmount)
                setLocalError('')
              }}
              required
            />
            <label className="block text-sm font-semibold text-foreground">
              Açıklama
              <input
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  setLocalError('')
                }}
                type="text"
                placeholder="Migros, benzin, yemek..."
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
                required
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2.5 min-[760px]:grid-cols-4">
            <label className="block min-w-0 text-sm font-semibold text-foreground">
              Tarih
              <input
                value={spentAt}
                onChange={(event) => {
                  setSpentAt(event.target.value)
                  setLocalError('')
                }}
                onClick={(event) => openNativePicker(event.currentTarget)}
                onFocus={(event) => openNativePicker(event.currentTarget)}
                type="date"
                className="mt-1 block w-full min-w-0 max-w-[10.75rem] appearance-none rounded-lg border border-input px-3 py-2.5 outline-none [color-scheme:light] transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 min-[480px]:max-w-full dark:bg-card/50 dark:text-foreground dark:[color-scheme:dark]"
              />
            </label>
            <CategoryPicker description={description} value={category} onChange={setCategory} memory={categoryMemory} autoApply />
            <label className="block min-w-0 text-sm font-semibold text-foreground">
              İşlem türü
              <select
                value={canUseInstallments ? paymentMode : 'cash'}
                onChange={(event) => {
                  const nextMode = event.target.value as 'cash' | 'installment'
                  setPaymentMode(nextMode)
                  if (nextMode === 'installment' && Number(installmentCount) < 2) setInstallmentCount('2')
                  setLocalError('')
                }}
                disabled={!canUseInstallments}
                className="mt-1 w-full min-w-0 rounded-lg border border-input bg-card/80 px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:bg-muted disabled:text-muted-foreground dark:bg-card/50 dark:text-foreground dark:disabled:bg-muted"
              >
                <option value="cash">Peşin</option>
                <option value="installment">Taksitli</option>
              </select>
            </label>
            <label className="block min-w-0 text-sm font-semibold text-foreground">
              Durum
              <select
                value={expenseStatus}
                onChange={(event) => {
                  setExpenseStatus(event.target.value as CardExpenseStatus)
                  setLocalError('')
                }}
                className="mt-1 w-full min-w-0 rounded-lg border border-input bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              >
                <option value="posted">Kesinleşmiş</option>
                <option value="provision">Provizyonda</option>
              </select>
            </label>
          </div>
          {canUseInstallments && paymentMode === 'installment' ? (
            <label className="block text-sm font-semibold text-foreground">
              Taksit sayısı
              <input
                value={installmentCount}
                onChange={(event) => {
                  setInstallmentCount(event.target.value)
                  setLocalError('')
                }}
                type="number"
                min="2"
                max="36"
                step="1"
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              />
            </label>
          ) : null}
          {selectedCard?.card_type === 'kredi_karti' ? (
            <div className="rounded-xl border border-success/20 bg-success/8 p-3">
              <div className="grid grid-cols-2 gap-2 min-[430px]:grid-cols-4">
                <OverviewStat label="Dönem" value={statementPreview?.periodLabel ?? 'Gün eksik'} />
                <OverviewStat label="Ekstre" value={statementPreview ? formatDate(statementPreview.statementDate) : 'Gün eksik'} />
                <OverviewStat label="Son ödeme" value={statementPreview ? formatDate(statementPreview.dueDate) : 'Gün eksik'} />
                <OverviewStat
                  label={isProvision ? 'Durum' : parsedInstallmentCount > 1 ? 'İlk yansıma' : 'Yansıma'}
                  value={isProvision ? 'Provizyon' : formatCurrency(firstPeriodAmount)}
                />
              </div>
              {statementPreview ? (
                <p className="mt-2 text-xs font-medium text-success">
                  {isProvision
                    ? `Bu işlem şimdilik sadece limitten düşer; kesinleşince ${statementPreview.statementMonthLabel} dönemine alınır.`
                    : `Bu işlem ${statementPreview.statementMonthLabel} ekstresine girer; ödeme planı ${formatDate(statementPreview.dueDate)} tarihine bağlanır.`}
                </p>
              ) : (
                <p className="mt-2 text-xs font-medium text-warning">
                  Kartta ekstre ve son ödeme günü eksik. Kartı güncellersen analizler daha net çalışır.
                </p>
              )}
            </div>
          ) : selectedCard ? (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 bg-muted/30 p-3">
              <OverviewStat label="Mevcut bakiye" value={formatCurrency(selectedCard.current_balance)} />
              <OverviewStat label="İşlem sonrası" value={formatCurrency(debitPreview)} />
            </div>
          ) : null}
          {localError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{localError}</p> : null}
          <button
            type="submit"
            disabled={!canSubmitQuickExpense}
            className="rounded-xl bg-success px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60 hover:bg-success/90"
          >
            {saving ? 'Ekleniyor...' : 'Harcamayı kaydet'}
          </button>
        </form>
      </CardContent>
    </SurfaceCard>
  )
}

export function LegacyInstallmentPanel({
  rows,
  reload,
  setError,
}: {
  rows: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
}) {
  const [cardId, setCardId] = useState(() => getLastUsed('expenseCard'))
  const [installmentAmount, setInstallmentAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diğer')
  const [totalInstallments, setTotalInstallments] = useState('9')
  const [paidInstallments, setPaidInstallments] = useState('3')
  const [nextDueMonth, setNextDueMonth] = useState(monthInputValue())
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)
  const categoryMemory = useCategoryMemory()

  const creditCards = useMemo(() => rows.filter((row) => row.card_type === 'kredi_karti'), [rows])
  const activeCardId = creditCards.some((card) => card.id === cardId) ? cardId : (creditCards[0]?.id ?? '')
  const selectedCard = creditCards.find((card) => card.id === activeCardId)
  const parsedInstallmentAmount = parseNumber(installmentAmount)
  const parsedTotalInstallments = Math.max(2, Math.min(36, parseInstallmentNumber(totalInstallments, 2)))
  const parsedPaidInstallments = Math.max(0, Math.min(parsedTotalInstallments - 1, parseInstallmentNumber(paidInstallments, 0)))
  const remainingCount = Math.max(1, parsedTotalInstallments - parsedPaidInstallments)
  const remainingAmount = Number((parsedInstallmentAmount * remainingCount).toFixed(2))
  const totalAmount = Number((parsedInstallmentAmount * parsedTotalInstallments).toFixed(2))
  const firstDueIsCurrentMonth = nextDueMonth === monthInputValue()
  const canSubmitLegacyInstallment =
    Boolean(selectedCard) &&
    parsedInstallmentAmount > 0 &&
    description.trim().length > 0 &&
    parsedPaidInstallments < parsedTotalInstallments &&
    isMonthValue(nextDueMonth) &&
    nextDueMonth >= monthInputValue()

  async function rollbackExpense(expenseId: string) {
    await supabase.from('card_expenses').delete().eq('id', expenseId)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedDescription = description.trim()
    const currentMonth = monthInputValue()
    if (!selectedCard) {
      setLocalError('Kredi kartı seçmelisin.')
      return
    }
    if (parsedInstallmentAmount <= 0) {
      setLocalError('Taksit tutarı 0 dan büyük olmalı.')
      return
    }
    if (!trimmedDescription) {
      setLocalError('Açıklama yazmalısın.')
      return
    }
    if (parsedPaidInstallments >= parsedTotalInstallments) {
      setLocalError('Ödenen taksit toplam taksitten küçük olmalı.')
      return
    }
    if (!isMonthValue(nextDueMonth)) {
      setLocalError('Sıradaki taksit ayını seçmelisin.')
      return
    }
    if (nextDueMonth < currentMonth) {
      setLocalError('Sıradaki taksit ayı geçmiş olamaz.')
      return
    }

    setSaving(true)
    setLocalError('')
    setError('')

    const { data: expense, error: expenseError } = await supabase
      .from('card_expenses')
      .insert({
        user_id: selectedCard.user_id,
        card_id: selectedCard.id,
        spent_at: addMonthsToMonth(nextDueMonth, -parsedPaidInstallments),
        amount: totalAmount,
        description: trimmedDescription,
        category,
        installment_count: parsedTotalInstallments,
        installment_amount: parsedInstallmentAmount,
        status: 'posted',
        posted_at: new Date().toISOString(),
        note: `${parsedPaidInstallments}/${parsedTotalInstallments} taksiti uygulama öncesinde ödendi.`,
      })
      .select()
      .single()

    if (expenseError || !expense) {
      setSaving(false)
      setLocalError(expenseError?.message ?? 'Taksit devri oluşturulamadı.')
      return
    }

    const installments: InsertFor<'card_installments'>[] = Array.from({ length: remainingCount }, (_, index) => {
      const installmentNo = parsedPaidInstallments + index + 1
      const dueMonth = addMonthsToMonth(nextDueMonth, index)
      const isCurrentMonth = dueMonth.slice(0, 7) === currentMonth

      return {
        user_id: selectedCard.user_id,
        card_id: selectedCard.id,
        card_expense_id: expense.id,
        installment_no: installmentNo,
        installment_count: parsedTotalInstallments,
        due_month: dueMonth,
        amount: parsedInstallmentAmount,
        description: trimmedDescription,
        category,
        status: isCurrentMonth ? 'posted' : 'scheduled',
        posted_at: isCurrentMonth ? new Date().toISOString() : null,
        paid_at: null,
        note: 'Uygulama öncesinden devreden taksit.',
      }
    })

    const { error: installmentError } = await supabase.from('card_installments').insert(installments)
    if (installmentError) {
      await rollbackExpense(expense.id)
      setSaving(false)
      setLocalError(installmentError.message)
      return
    }

    const { error: cardUpdateError } = await supabase
      .from('cards')
      .update({
        debt_amount: selectedCard.debt_amount + remainingAmount,
        current_period_spending: selectedCard.current_period_spending + (firstDueIsCurrentMonth ? parsedInstallmentAmount : 0),
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedCard.id)

    if (cardUpdateError) {
      await rollbackExpense(expense.id)
      setSaving(false)
      setLocalError(cardUpdateError.message)
      return
    }

    const historyError = await addTransactionHistory({
      user_id: selectedCard.user_id,
      type: 'card',
      title: `${trimmedDescription} taksit devri`,
      amount: remainingAmount,
      source_table: 'card_expenses',
      source_id: expense.id,
      note: `${parsedPaidInstallments}/${parsedTotalInstallments} taksit ödenmiş; kalan ${remainingCount} taksit eklendi.`,
    })
    if (historyError) {
      setError(`Devir eklendi, ancak işlem geçmişi yazılamadı: ${historyError.message}`)
    }

    invalidateCategoryMemory()
    setSaving(false)
    setLastUsed('expenseCard', selectedCard.id)
    setCardId(selectedCard.id)
    setInstallmentAmount('')
    setDescription('')
    setCategory(expenseCategoryOptions[0]?.value ?? 'Diğer')
    setTotalInstallments('9')
    setPaidInstallments('3')
    setNextDueMonth(monthInputValue())
    await reload()
  }

  if (creditCards.length === 0) return null

  return (
    <SurfaceCard className="border-warning/20 shadow-[var(--shadow-card)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Taksit devri</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Önceden başlamış taksitlerin kalan aylarını ekle.</p>
          </div>
          <Badge variant="outline">{remainingCount} kalan</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <label className="block text-sm font-semibold text-foreground">
            Kart
            <select
              value={activeCardId}
              onChange={(event) => {
                const nextCardId = event.target.value
                setCardId(nextCardId)
                setLastUsed('expenseCard', nextCardId)
                setLocalError('')
              }}
              className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              required
            >
              {creditCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {cardOptionLabel(card)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[minmax(0,0.74fr)_minmax(0,1.26fr)] gap-2.5">
            <MoneyInput
              label="Taksit tutarı"
              value={installmentAmount}
              onValueChange={(nextAmount) => {
                setInstallmentAmount(nextAmount)
                setLocalError('')
              }}
              required
            />
            <label className="block text-sm font-semibold text-foreground">
              Açıklama
              <input
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  setLocalError('')
                }}
                type="text"
                placeholder="Telefon, beyaz eşya..."
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
                required
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-sm font-semibold text-foreground">
              Toplam
              <input
                value={totalInstallments}
                onChange={(event) => {
                  setTotalInstallments(event.target.value)
                  setLocalError('')
                }}
                type="number"
                min="2"
                max="36"
                step="1"
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              />
            </label>
            <label className="block text-sm font-semibold text-foreground">
              Ödenen
              <input
                value={paidInstallments}
                onChange={(event) => {
                  setPaidInstallments(event.target.value)
                  setLocalError('')
                }}
                type="number"
                min="0"
                max={Math.max(0, parsedTotalInstallments - 1)}
                step="1"
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2">
            <label className="block min-w-0 text-sm font-semibold text-foreground">
              Sıradaki ay
              <input
                value={nextDueMonth}
                onChange={(event) => {
                  setNextDueMonth(event.target.value)
                  setLocalError('')
                }}
                type="month"
                min={monthInputValue()}
                className="mt-1 block w-full min-w-0 max-w-[10.75rem] appearance-none rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 min-[480px]:max-w-full dark:bg-card/50 dark:text-foreground"
                required
              />
            </label>
            <CategoryPicker description={description} value={category} onChange={setCategory} memory={categoryMemory} autoApply />
          </div>
          <p className="rounded-xl border border-warning/20 bg-warning/8 px-3 py-2.5 text-xs font-medium text-warning">
            Kalan {formatCurrency(remainingAmount)} tutarı otomatik olarak kart borcuna eklenir; böylece gelecek taksitler limit hesabına yansır.
          </p>
          <InstallmentPlanner
            compact
            remainingCount={remainingCount}
            totalInstallments={parsedTotalInstallments}
            remainingAmount={remainingAmount}
            firstLabel={formatMonthLabel(nextDueMonth)}
            monthlyAmount={parsedInstallmentAmount}
          />
          {localError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{localError}</p> : null}
          <button
            type="submit"
            disabled={saving || !canSubmitLegacyInstallment}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
          >
            <CalendarClock size={16} />
            {saving ? 'Ekleniyor...' : 'Devir taksitlerini ekle'}
          </button>
        </form>
      </CardContent>
    </SurfaceCard>
  )
}

export function ProvisionPanel({
  rows,
  provisions,
  loading,
  actionId,
  onPost,
  onPostAll,
  onCancel,
}: {
  rows: Card[]
  provisions: CardExpense[]
  loading: boolean
  actionId: string | null
  onPost: (expense: CardExpense) => void
  onPostAll: (expenses: CardExpense[]) => void
  onCancel: (expense: CardExpense) => void
}) {
  const pending = provisions.filter((expense) => expense.status === 'provision')
  const cardsById = useMemo(() => new Map(rows.map((card) => [card.id, card])), [rows])
  const totalProvision = pending.reduce((total, expense) => total + expense.amount, 0)
  if (loading && pending.length === 0) {
    return (
      <SurfaceCard className="border-warning/20 shadow-[var(--shadow-card)]">
        <CardContent className="p-4 text-sm text-muted-foreground">Provizyonlar yükleniyor...</CardContent>
      </SurfaceCard>
    )
  }

  if (pending.length === 0) return null

  return (
    <SurfaceCard className="border-warning/20 shadow-[var(--shadow-card)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 size={17} />
              Provizyondaki işlemler
              <HelpTooltip title="Provizyondaki işlemler" content={cardHelp.provisionsPanel} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Kesinleşince dönem içine alınır, iptal edilirse limitten çıkarılır.</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant="secondary">{formatCurrency(totalProvision)}</Badge>
            <button
              type="button"
              onClick={() => onPostAll(pending)}
              disabled={Boolean(actionId)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-success px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60 hover:bg-success/90"
            >
              <CheckCircle2 size={13} />
              {actionId === 'post-all' ? 'Aktarılıyor...' : 'Tümünü aktar'}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {pending.map((expense) => {
          const card = cardsById.get(expense.card_id)
          const postActionId = `post-${expense.id}`
          const cancelActionId = `cancel-${expense.id}`

          return (
            <div key={expense.id} className="rounded-xl border border-warning/15 bg-warning/8 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{expense.description}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {card ? `${card.bank_name} · ${card.card_name}` : 'Kart'} · {formatDate(expense.spent_at)}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-card px-2 py-1 text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatCurrency(expense.amount)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onPost(expense)}
                  disabled={Boolean(actionId)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 hover:bg-success/90"
                >
                  <CheckCircle2 size={14} />
                  {actionId === postActionId ? 'İşleniyor...' : 'Kesinleştir'}
                </button>
                <button
                  type="button"
                  onClick={() => onCancel(expense)}
                  disabled={Boolean(actionId)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/15 disabled:opacity-50"
                >
                  <XCircle size={14} />
                  {actionId === cancelActionId ? 'İşleniyor...' : 'İptal et'}
                </button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </SurfaceCard>
  )
}

export function StatementPanel({
  rows,
  statements,
  loading,
  actionId,
  onPay,
}: {
  rows: Card[]
  statements: CardStatementArchive[]
  loading: boolean
  actionId: string | null
  onPay: (statement: CardStatementArchive, card: Card) => void
}) {
  const cardsById = useMemo(() => new Map(rows.map((card) => [card.id, card])), [rows])
  const openStatements = statements
    .filter((statement) => statement.status === 'open')
    .sort((a, b) => (a.due_date ?? a.statement_date).localeCompare(b.due_date ?? b.statement_date))
  const totalOpenAmount = openStatements.reduce((total, statement) => total + statement.statement_debt_amount, 0)

  if (loading && openStatements.length === 0) {
    return (
      <SurfaceCard className="border-success/20 shadow-[var(--shadow-card)]">
        <CardContent className="p-4 text-sm text-muted-foreground">Ekstreler yukleniyor...</CardContent>
      </SurfaceCard>
    )
  }

  if (openStatements.length === 0) return null

  return (
    <SurfaceCard className="border-success/20 shadow-[var(--shadow-card)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText size={17} />
              Acik ekstreler
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Ekstre odendiginde bu ekstreye bagli kart taksitleri otomatik kapanir.</p>
          </div>
          <Badge variant="secondary">{formatCurrency(totalOpenAmount)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {openStatements.map((statement) => {
          const card = cardsById.get(statement.card_id)
          if (!card) return null

          return (
            <div key={statement.id} className="rounded-xl border border-success/15 bg-success/8 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{card.card_name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {card.bank_name} - {statementPeriodLabel(statement)} - son odeme {formatDate(statement.due_date)}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-card px-2 py-1 text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatCurrency(statement.statement_debt_amount)}
                </span>
              </div>
              <div className="mt-3 grid gap-2 min-[520px]:grid-cols-[minmax(0,1fr)_auto] min-[520px]:items-center">
                <p className="text-xs leading-5 text-success/80">
                  Bu tutar kart borcunun icindedir. Kredi karti taksitleri ayrica borc olarak ikinci kez eklenmez.
                </p>
                <button
                  type="button"
                  onClick={() => onPay(statement, card)}
                  disabled={Boolean(actionId)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60 hover:bg-success/90"
                >
                  <CheckCircle2 size={14} />
                  {actionId === statement.id ? 'Isleniyor...' : 'Ekstreyi odendi isaretle'}
                </button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </SurfaceCard>
  )
}

function shouldRunStatementCut(card: Card, statements: CardStatementArchive[]) {
  return canCutCurrentStatement(card, statements)
}

export function DueStatementAutomation({
  rows,
  statements,
  statementsLoading,
  reload,
  loadStatements,
  setError,
}: {
  rows: Card[]
  statements: CardStatementArchive[]
  statementsLoading: boolean
  reload: () => Promise<void>
  loadStatements: () => Promise<void>
  setError: (message: string) => void
}) {
  useEffect(() => {
    if (statementsLoading) return
    if (!rows.some((card) => shouldRunStatementCut(card, statements))) return

    let cancelled = false

    async function runDueStatementCut() {
      const { data, error } = await supabase.rpc('cut_due_card_statements')

      if (error) {
        if (!isSchemaCacheError(error)) setError(error.message)
        return
      }

      if (!cancelled && (data ?? 0) > 0) {
        await Promise.all([reload(), loadStatements()])
      }
    }

    void runDueStatementCut()

    return () => {
      cancelled = true
    }
  }, [loadStatements, reload, rows, setError, statements, statementsLoading])

  return null
}

