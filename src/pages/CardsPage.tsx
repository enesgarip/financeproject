import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CreditCard as CreditCardIcon,
  LayoutGrid,
  ReceiptText,
  XCircle,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { AccountSelector } from '../components/finance/AccountSelector'
import { CategoryPicker } from '../components/finance/CategoryPicker'
import { CardInstallmentCalendarPanel } from '../components/finance/CardInstallmentCalendarPanel'
import { CardInstallmentExpensesPanel } from '../components/finance/CardInstallmentExpensesPanel'
import { BankLogo } from '../components/finance/BankLogo'
import { AmountDisplay, FinancePanel, MiniStat, ProgressStrip, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import { InstallmentPlanner } from '../components/finance/InstallmentPlanner'
import { MoneyInput } from '../components/finance/MoneyInput'
import { SimpleModal } from '../components/SimpleModal'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../components/ui/help-tooltip'
import { Progress } from '../components/ui/progress'
import { supabase } from '../lib/supabase'
import type { Card, CardExpense, CardExpenseStatus, CardInstallment, CardStatementArchive, InsertFor } from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { getCardStatementPeriod } from '../utils/cardStatement'
import { dateInputValue, daysUntil, formatDate, nextMonthlyDate } from '../utils/date'
import { cardPayableDebt, cardProvisionAmount, cardSplitTotal } from '../utils/financeSummary'
import { bankBrandGradient, getBankBrand } from '../utils/bankBranding'
import { cn } from '../lib/utils'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { addTransactionHistory } from '../utils/history'

type CardSection = 'ozet' | 'kartlar' | 'islemler' | 'ekstreler'

const cardSections = [
  { id: 'ozet', label: 'Özet', icon: LayoutGrid },
  { id: 'kartlar', label: 'Kartlar', icon: CreditCardIcon },
  { id: 'islemler', label: 'İşlemler', icon: ReceiptText },
  { id: 'ekstreler', label: 'Ekstreler', icon: CalendarClock },
] as const satisfies readonly { id: CardSection; label: string; icon: typeof LayoutGrid }[]

function CardSectionNav({
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

const fields: FormField[] = [
  { name: 'bank_name', label: 'Banka', type: 'text', required: true },
  { name: 'card_name', label: 'Kart / hesap adı', type: 'text', required: true },
  {
    name: 'holder_name',
    label: 'Kart sahibi',
    type: 'text',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'card_type',
    label: 'Tür',
    type: 'select',
    options: [
      { label: 'Kredi kartı', value: 'kredi_karti' },
      { label: 'Banka kartı', value: 'banka_karti' },
    ],
  },
  {
    name: 'limit_group_name',
    label: 'Ortak limit grubu',
    type: 'text',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'credit_limit',
    label: 'Limit / ortak limit',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'statement_debt_amount',
    label: 'Ekstre borcu (ödenecek)',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'current_period_spending',
    label: 'Dönem içi kesinleşen',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'provision_amount',
    label: 'Provizyon bekleyen',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'statement_day',
    label: 'Ekstre günü',
    type: 'day',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'due_day',
    label: 'Son ödeme günü',
    type: 'day',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'current_balance',
    label: 'Bakiye',
    type: 'number',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'banka_karti' },
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

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

function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function cardTypeLabel(value: Card['card_type']) {
  if (value === 'kredi_karti') return 'Kredi kartı'
  return 'Banka kartı'
}

function cardGroupLabel(row: Card) {
  if (row.card_type === 'kredi_karti') return row.limit_group_name?.trim() ? `Ortak limit · ${row.limit_group_name.trim()}` : 'Tekil kredi kartları'
  return 'Banka kartları'
}

function normalizeBankName(bankName: string) {
  return bankName.trim().toLocaleLowerCase('tr-TR')
}

function bankHue(bankName: string, rows: Card[]) {
  const banks = Array.from(new Set(rows.map((row) => normalizeBankName(row.bank_name)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'tr-TR'),
  )
  const index = Math.max(0, banks.indexOf(normalizeBankName(bankName)))

  return (index * 47 + 196) % 360
}

function bankHueStyle(bankName: string, rows: Card[]) {
  return { '--bank-hue': String(bankHue(bankName, rows)) } as CSSProperties
}

function isSchemaCacheError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === 'PGRST202' || error.code === 'PGRST205' || message.includes('schema cache') || message.includes('Could not find the function')
}

function limitGroupKey(card: Card) {
  return card.limit_group_name?.trim() || card.id
}

function limitGroupCards(card: Card, rows: Card[]) {
  const key = limitGroupKey(card)
  return rows.filter((row) => row.card_type === 'kredi_karti' && limitGroupKey(row) === key)
}

function limitGroupStats(card: Card, rows: Card[]) {
  const groupCards = limitGroupCards(card, rows)
  const sharedLimit = Math.max(...groupCards.map((row) => row.credit_limit), card.credit_limit, 0)
  const totalDebt = groupCards.reduce((total, row) => total + row.debt_amount, 0)
  const provisionAmount = groupCards.reduce((total, row) => total + cardProvisionAmount(row), 0)
  return {
    sharedLimit,
    totalDebt,
    provisionAmount,
    availableLimit: Math.max(0, sharedLimit - totalDebt),
    usageRate: sharedLimit > 0 ? Math.min(100, (totalDebt / sharedLimit) * 100) : 0,
    isShared: Boolean(card.limit_group_name?.trim()) && groupCards.length > 1,
  }
}

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

function CreditCardOverview({ rows }: { rows: Card[] }) {
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

function AccountHubPanel({
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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Hesap merkezi</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Banka hesapları, kredi kartı yükü ve transferler tek yerde.</p>
          </div>
          {accounts[0] ? (
            <button
              type="button"
              onClick={() => onOpenTransfer(accounts[0])}
              disabled={!canTransfer}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground shadow-sm disabled:opacity-55"
            >
              <ArrowRightLeft size={14} />
              Transfer
            </button>
          ) : null}
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

function CreditAccountListCard({
  row,
  rows,
  statements,
  installments,
  menu,
  rowActions,
  reload,
  setError,
  onTransfer,
  onPayDebt,
  onCutStatement,
  onAddExpense,
}: {
  row: Card
  rows: Card[]
  statements: CardStatementArchive[]
  installments: CardInstallment[]
  menu: React.ReactNode
  rowActions: React.ReactNode
  reload: () => Promise<void>
  setError: (message: string) => void
  onTransfer: (source: Card) => void
  onPayDebt: (card: Card, reload: () => Promise<void>, rows: Card[]) => void
  onCutStatement: (card: Card, reload: () => Promise<void>, setError: (message: string) => void) => Promise<void>
  onAddExpense: (card: Card, mode: 'cash' | 'installment') => void
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
          onClick={() => onPayDebt(row, reload, rows)}
          disabled={payableDebt <= 0}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-55"
        >
          <ReceiptText size={14} />
          Ekstreyi öde
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
          onClick={() => onAddExpense(row, 'installment')}
          className="finance-touch-target inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Taksit ekle
        </button>
        <button
          type="button"
          onClick={() => void onCutStatement(row, reload, setError)}
          disabled={row.current_period_spending <= 0}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted disabled:opacity-55"
        >
          Ekstre kes
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
  return Math.round((amount / Math.max(1, pieces) + Number.EPSILON) * 100) / 100
}

function formatMonthLabel(month: string) {
  if (!isMonthValue(month)) return '-'
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${monthDateValue(month)}T00:00:00`))
}

function parseInstallmentNumber(value: string, fallback: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

function QuickExpensePanel({
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
  const [cardId, setCardId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [spentAt, setSpentAt] = useState(dateInputValue(new Date()))
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diğer')
  const [paymentMode, setPaymentMode] = useState<'cash' | 'installment'>('cash')
  const [installmentCount, setInstallmentCount] = useState('1')
  const [expenseStatus, setExpenseStatus] = useState<CardExpenseStatus>('posted')
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)
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
    if (focus.mode === 'installment' && targetCard.card_type === 'kredi_karti') {
      setPaymentMode('installment')
      setInstallmentCount((current) => (Number(current) < 2 ? '2' : current))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

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
          <label className="block text-sm font-semibold text-foreground">
            Kart
            <select
              value={activeCardId}
              onChange={(event) => {
                setCardId(event.target.value)
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
                onClick={(event) => event.currentTarget.showPicker?.()}
                onFocus={(event) => event.currentTarget.showPicker?.()}
                type="date"
                className="mt-1 block w-full min-w-0 max-w-[10.75rem] appearance-none rounded-lg border border-input px-3 py-2.5 outline-none [color-scheme:light] transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 min-[480px]:max-w-full dark:bg-card/50 dark:text-foreground dark:[color-scheme:dark]"
              />
            </label>
            <CategoryPicker description={description} value={category} onChange={setCategory} />
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

function LegacyInstallmentPanel({
  rows,
  reload,
  setError,
}: {
  rows: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
}) {
  const [cardId, setCardId] = useState('')
  const [installmentAmount, setInstallmentAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diğer')
  const [totalInstallments, setTotalInstallments] = useState('9')
  const [paidInstallments, setPaidInstallments] = useState('3')
  const [nextDueMonth, setNextDueMonth] = useState(monthInputValue())
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)

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

    setSaving(false)
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
                setCardId(event.target.value)
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
            <CategoryPicker description={description} value={category} onChange={setCategory} />
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

function ProvisionPanel({
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
  onPost: (expense: CardExpense, amount?: number) => void
  onPostAll: (expenses: CardExpense[]) => void
  onCancel: (expense: CardExpense) => void
}) {
  const pending = provisions.filter((expense) => expense.status === 'provision')
  const cardsById = useMemo(() => new Map(rows.map((card) => [card.id, card])), [rows])
  const totalProvision = pending.reduce((total, expense) => total + expense.amount, 0)
  const [partialAmounts, setPartialAmounts] = useState<Record<string, string>>({})
  const [partialErrors, setPartialErrors] = useState<Record<string, string>>({})

  function updatePartialAmount(expenseId: string, value: string) {
    setPartialAmounts((current) => ({ ...current, [expenseId]: value }))
    setPartialErrors((current) => {
      if (!current[expenseId]) return current
      const next = { ...current }
      delete next[expenseId]
      return next
    })
  }

  function handlePartialPost(expense: CardExpense) {
    const amount = parseNumber(partialAmounts[expense.id] ?? '')

    if (amount <= 0) {
      setPartialErrors((current) => ({ ...current, [expense.id]: 'Aktarılacak tutarı yazmalısın.' }))
      return
    }

    if (amount > expense.amount) {
      setPartialErrors((current) => ({ ...current, [expense.id]: 'Tutar kalan provizyondan büyük olamaz.' }))
      return
    }

    setPartialAmounts((current) => {
      const next = { ...current }
      delete next[expense.id]
      return next
    })
    onPost(expense, amount === expense.amount ? undefined : amount)
  }

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
              <div className="mt-3 rounded-lg border border-warning/20 bg-card/60 p-2.5">
                <div className="grid gap-2 min-[520px]:grid-cols-[minmax(0,1fr)_auto] min-[520px]:items-start">
                  <MoneyInput
                    label="Kısmi aktarılacak tutar"
                    value={partialAmounts[expense.id] ?? ''}
                    onValueChange={(value) => updatePartialAmount(expense.id, value)}
                    placeholder={formatCurrency(expense.amount)}
                  />
                  <button
                    type="button"
                    onClick={() => handlePartialPost(expense)}
                    disabled={Boolean(actionId)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-success/25 bg-success/8 px-3 py-2 text-xs font-semibold text-success transition hover:bg-success/15 disabled:opacity-50 min-[520px]:mt-6"
                  >
                    <CheckCircle2 size={14} />
                    {actionId === `partial-${expense.id}` ? 'Aktarılıyor...' : 'Kısmi aktar'}
                  </button>
                </div>
                {partialErrors[expense.id] ? (
                  <p className="mt-2 text-xs font-semibold text-destructive">{partialErrors[expense.id]}</p>
                ) : (
                  <p className="mt-2 text-xs text-warning/80">
                    Kalan tutar provizyonda bekler; önceki provizyon kayıtları da bu alandan parçalı aktarılır.
                  </p>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onPost(expense)}
                  disabled={Boolean(actionId)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 hover:bg-success/90"
                >
                  <CheckCircle2 size={14} />
                  {actionId === postActionId ? 'İşleniyor...' : 'Tamamını aktar'}
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

function statementPeriodLabel(statement: CardStatementArchive) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(statement.period_year, statement.period_month - 1, 1))
}

function StatementPanel({
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

function shouldRunStatementCut(card: Card) {
  if (card.card_type !== 'kredi_karti' || !card.statement_day || card.current_period_spending <= 0) return false

  const today = new Date()
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  return Math.min(card.statement_day, lastDay) <= today.getDate()
}

function DueStatementAutomation({
  rows,
  reload,
  loadStatements,
  setError,
}: {
  rows: Card[]
  reload: () => Promise<void>
  loadStatements: () => Promise<void>
  setError: (message: string) => void
}) {
  useEffect(() => {
    if (!rows.some(shouldRunStatementCut)) return

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
  }, [loadStatements, reload, rows, setError])

  return null
}

export function CardsPage() {
  const [section, setSection] = useState<CardSection>('ozet')
  const [transactionCard, setTransactionCard] = useState<Card | null>(null)
  const [transactionType, setTransactionType] = useState<'in' | 'out' | 'transfer'>('in')
  const [transactionAmount, setTransactionAmount] = useState('')
  const [transactionTargetCard, setTransactionTargetCard] = useState('')
  const [transactionError, setTransactionError] = useState('')
  const [transactionSaving, setTransactionSaving] = useState(false)
  const [movementAccounts, setMovementAccounts] = useState<Card[]>([])
  const [reloadCards, setReloadCards] = useState<(() => Promise<void>) | null>(null)
  const [debtPaymentCard, setDebtPaymentCard] = useState<Card | null>(null)
  const [debtPaymentAmount, setDebtPaymentAmount] = useState('')
  const [debtPaymentSourceCard, setDebtPaymentSourceCard] = useState('')
  const [debtPaymentError, setDebtPaymentError] = useState('')
  const [debtPaymentSaving, setDebtPaymentSaving] = useState(false)
  const [allCards, setAllCards] = useState<Card[]>([])
  const [provisions, setProvisions] = useState<CardExpense[]>([])
  const [provisionsLoading, setProvisionsLoading] = useState(false)
  const [provisionError, setProvisionError] = useState('')
  const [provisionActionId, setProvisionActionId] = useState<string | null>(null)
  const [statements, setStatements] = useState<CardStatementArchive[]>([])
  const [statementsLoading, setStatementsLoading] = useState(false)
  const [statementError, setStatementError] = useState('')
  const [statementActionId, setStatementActionId] = useState<string | null>(null)
  const [installments, setInstallments] = useState<CardInstallment[]>([])
  const [statementPayment, setStatementPayment] = useState<{ statement: CardStatementArchive; card: Card } | null>(null)
  const [statementPaymentAccounts, setStatementPaymentAccounts] = useState<Card[]>([])
  const [statementPaymentSourceCard, setStatementPaymentSourceCard] = useState('')
  const [statementPaymentError, setStatementPaymentError] = useState('')
  const [statementPaymentSaving, setStatementPaymentSaving] = useState(false)

  const loadProvisions = useCallback(async () => {
    setProvisionsLoading(true)
    setProvisionError('')
    const { data, error } = await supabase
      .from('card_expenses')
      .select('*')
      .eq('status', 'provision')
      .order('spent_at', { ascending: false })

    if (error) {
      setProvisions([])
      setProvisionError(
        isSchemaCacheError(error)
          ? 'Provizyon altyapısı henüz canlı veritabanında yok. Migration uygulanınca bu liste açılacak.'
          : error.message,
      )
    } else {
      setProvisions((data ?? []) as CardExpense[])
    }
    setProvisionsLoading(false)
  }, [])

  const loadStatements = useCallback(async () => {
    setStatementsLoading(true)
    setStatementError('')
    const { data, error } = await supabase
      .from('card_statement_archives')
      .select('*')
      .order('statement_date', { ascending: false })
      .limit(24)

    if (error) {
      setStatements([])
      setStatementError(
        isSchemaCacheError(error)
          ? 'Ekstre odeme altyapisi henuz canli veritabaninda yok. Migration uygulaninca bu panel acilacak.'
          : error.message,
      )
    } else {
      setStatements((data ?? []) as CardStatementArchive[])
    }
    setStatementsLoading(false)
  }, [])

  const loadInstallments = useCallback(async () => {
    const { data, error } = await supabase
      .from('card_installments')
      .select('*')
      .order('due_month', { ascending: true })

    if (error) {
      setInstallments([])
      return
    }

    setInstallments((data ?? []) as CardInstallment[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProvisions()
  }, [loadProvisions])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatements()
  }, [loadStatements])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInstallments()
  }, [loadInstallments])

  async function refreshCardsAndProvisions(reload: () => Promise<void>) {
    await Promise.all([reload(), loadProvisions(), loadStatements(), loadInstallments()])
  }

  async function handleProvisionAction(
    expense: CardExpense,
    action: 'post' | 'cancel',
    reload: () => Promise<void>,
    setError: (message: string) => void,
    amount?: number,
  ) {
    setProvisionActionId(amount !== undefined ? `partial-${expense.id}` : `${action}-${expense.id}`)
    setError('')
    setProvisionError('')

    const rpcName = action === 'post' ? 'post_card_provision' : 'cancel_card_provision'
    const rpcArgs = amount !== undefined ? { p_expense_id: expense.id, p_post_amount: amount } : { p_expense_id: expense.id }
    const { error } = await supabase.rpc(rpcName, rpcArgs)

    if (error) {
      const message = isSchemaCacheError(error)
        ? 'Provizyon altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
        : error.message
      setError(message)
      setProvisionActionId(null)
      return
    }

    await refreshCardsAndProvisions(reload)
    setProvisionActionId(null)
  }

  async function handlePostAllProvisions(expenses: CardExpense[], reload: () => Promise<void>, setError: (message: string) => void) {
    const pendingExpenses = expenses.filter((expense) => expense.status === 'provision')
    if (pendingExpenses.length === 0) return

    setProvisionActionId('post-all')
    setError('')
    setProvisionError('')

    for (const expense of pendingExpenses) {
      const { error } = await supabase.rpc('post_card_provision', { p_expense_id: expense.id })
      if (error) {
        setError(
          isSchemaCacheError(error)
            ? 'Provizyon altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
            : error.message,
        )
        await refreshCardsAndProvisions(reload)
        setProvisionActionId(null)
        return
      }
    }

    await refreshCardsAndProvisions(reload)
    setProvisionActionId(null)
  }

  function openTransaction(card: Card, reload: () => Promise<void>, cards: Card[], type: 'in' | 'out' | 'transfer' = 'in') {
    const accounts = cards.filter((row) => row.card_type === 'banka_karti')
    setTransactionCard(card)
    setReloadCards(() => reload)
    setMovementAccounts(accounts)
    setTransactionType(type)
    setTransactionAmount('')
    setTransactionTargetCard('')
    setTransactionError('')
  }

  async function handleTransactionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!transactionCard) return

    const amount = parseNumber(transactionAmount)
    if (amount <= 0) {
      setTransactionError('Tutar 0 dan büyük olmalı.')
      return
    }

    if (transactionType === 'transfer') {
      const targetCard = movementAccounts.find((card) => card.id === transactionTargetCard)
      if (!targetCard) {
        setTransactionError('Hedef hesap seçmelisin.')
        return
      }

      if (targetCard.id === transactionCard.id) {
        setTransactionError('Kaynak ve hedef hesap aynı olamaz.')
        return
      }

      if (transactionCard.current_balance < amount) {
        setTransactionError('Kaynak hesap bakiyesi yetersiz.')
        return
      }

      setTransactionSaving(true)
      setTransactionError('')

      const { error } = await supabase.rpc('transfer_between_accounts', {
        p_source_card_id: transactionCard.id,
        p_target_card_id: targetCard.id,
        p_amount: amount,
      })

      setTransactionSaving(false)
      if (error) {
        setTransactionError(
          isSchemaCacheError(error)
            ? 'Transfer altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
            : error.message,
        )
        return
      }

      setTransactionCard(null)
      await reloadCards?.()
      return
    }

    const nextBalance = transactionType === 'in' ? transactionCard.current_balance + amount : transactionCard.current_balance - amount
    if (nextBalance < 0) {
      setTransactionError('Giden tutar mevcut bakiyeden büyük olamaz.')
      return
    }

    setTransactionSaving(true)
    setTransactionError('')
    const { error } = await supabase
      .from('cards')
      .update({ current_balance: nextBalance, updated_at: new Date().toISOString() })
      .eq('id', transactionCard.id)

    setTransactionSaving(false)
    if (error) {
      setTransactionError(error.message)
      return
    }

    const historyError = await addTransactionHistory({
      user_id: transactionCard.user_id,
      type: 'transfer',
      title: `${transactionCard.card_name} ${transactionType === 'in' ? 'para girişi' : 'para çıkışı'}`,
      amount,
      source_table: 'cards',
      source_id: transactionCard.id,
      note: transactionType === 'in' ? 'Banka kartına para geldi.' : 'Banka kartından para çıktı.',
    })
    if (historyError) {
      setTransactionError(historyError.message)
      return
    }

    setTransactionCard(null)
    await reloadCards?.()
  }

  function openDebtPayment(card: Card, reload: () => Promise<void>, cards: Card[]) {
    setDebtPaymentCard(card)
    setReloadCards(() => reload)
    setAllCards(cards.filter((c) => c.card_type === 'banka_karti' && c.id !== card.id))
    setDebtPaymentAmount(String(card.statement_debt_amount || cardPayableDebt(card) || ''))
    setDebtPaymentSourceCard('')
    setDebtPaymentError('')
  }

  async function handleDebtPaymentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!debtPaymentCard) return

    const amount = parseNumber(debtPaymentAmount)
    if (amount <= 0) {
      setDebtPaymentError('Tutar 0 dan büyük olmalı.')
      return
    }

    if (!debtPaymentSourceCard) {
      setDebtPaymentError('Kaynak hesap seçmelisin.')
      return
    }

    const sourceCard = allCards.find((c) => c.id === debtPaymentSourceCard)
    if (!sourceCard) {
      setDebtPaymentError('Kaynak hesap bulunamadı.')
      return
    }

    if (sourceCard.current_balance < amount) {
      setDebtPaymentError('Kaynak hesap bakiyesi yetersiz.')
      return
    }

    const payableDebt = cardPayableDebt(debtPaymentCard)
    if (payableDebt <= 0) {
      setDebtPaymentError('Ödenebilir kesinleşmiş borç yok. Provizyon kesinleşince ödeme yapabilirsin.')
      return
    }

    if (amount > payableDebt) {
      setDebtPaymentError('Ödeme tutarı provizyon hariç kesinleşmiş borçtan büyük olamaz.')
      return
    }

    setDebtPaymentSaving(true)
    setDebtPaymentError('')

    const { error } = await supabase.rpc('pay_card_debt', {
      p_card_id: debtPaymentCard.id,
      p_source_card_id: sourceCard.id,
      p_amount: amount,
    })

    setDebtPaymentSaving(false)
    if (error) {
      setDebtPaymentError(error.message)
      return
    }

    setDebtPaymentCard(null)
    await reloadCards?.()
  }

  function openStatementPayment(statement: CardStatementArchive, card: Card, cards: Card[], reload: () => Promise<void>) {
    const accounts = cards.filter((row) => row.card_type === 'banka_karti' && row.id !== card.id)
    setStatementPayment({ statement, card })
    setStatementPaymentAccounts(accounts)
    setStatementPaymentSourceCard('')
    setStatementPaymentError(accounts.length === 0 ? 'Ekstre odemesi icin once bir banka hesabi eklemelisin.' : '')
    setReloadCards(() => reload)
  }

  function closeStatementPayment() {
    setStatementPayment(null)
    setStatementPaymentSourceCard('')
    setStatementPaymentError('')
  }

  async function handleStatementPaymentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!statementPayment) return

    if (!statementPaymentSourceCard) {
      setStatementPaymentError('Kaynak hesap secmelisin.')
      return
    }

    const sourceCard = statementPaymentAccounts.find((card) => card.id === statementPaymentSourceCard)
    if (!sourceCard) {
      setStatementPaymentError('Kaynak hesap bulunamadi.')
      return
    }

    if (sourceCard.current_balance < statementPayment.statement.statement_debt_amount) {
      setStatementPaymentError('Kaynak hesap bakiyesi yetersiz.')
      return
    }

    setStatementPaymentSaving(true)
    setStatementActionId(statementPayment.statement.id)
    setStatementPaymentError('')

    const { error } = await supabase.rpc('pay_card_statement', {
      p_statement_id: statementPayment.statement.id,
      p_source_card_id: sourceCard.id,
    })

    setStatementPaymentSaving(false)
    setStatementActionId(null)

    if (error) {
      setStatementPaymentError(
        isSchemaCacheError(error)
          ? 'Ekstre odeme altyapisi canli veritabanina uygulanmamis. Migration calisinca bu islem acilacak.'
          : error.message,
      )
      return
    }

    closeStatementPayment()
    await Promise.all([reloadCards?.(), loadStatements(), loadInstallments()])
  }

  async function cutStatement(card: Card, reload: () => Promise<void>, setError: (message: string) => void) {
    if (card.current_period_spending <= 0) {
      setError('Dönem içi harcama olmadığı için kesilecek ekstre yok.')
      return
    }

    const { error } = await supabase.rpc('cut_card_statement', {
      p_card_id: card.id,
    })

    if (error) {
      if (!isSchemaCacheError(error)) {
        setError(error.message)
        return
      }

      const statementDebt = card.statement_debt_amount + card.current_period_spending
      const { error: updateError } = await supabase
        .from('cards')
        .update({ statement_debt_amount: statementDebt, current_period_spending: 0, updated_at: new Date().toISOString() })
        .eq('id', card.id)

      if (updateError) {
        setError(updateError.message)
        return
      }

      const historyError = await addTransactionHistory({
        user_id: card.user_id,
        type: 'card',
        title: `${card.card_name} ekstresi kesildi`,
        amount: card.current_period_spending,
        source_table: 'cards',
        source_id: card.id,
        note: 'Dönem borcuna aktarıldı.',
      })
      if (historyError) {
        setError(historyError.message)
        return
      }

      await Promise.all([reload(), loadStatements()])
      return
    }

    await Promise.all([reload(), loadStatements()])
  }

  const [quickExpenseFocus, setQuickExpenseFocus] = useState<{ cardId: string; mode: 'cash' | 'installment'; nonce: number } | null>(null)

  const handleSectionChange = useCallback((next: CardSection) => {
    setSection(next)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const focusQuickExpense = useCallback((card: Card, mode: 'cash' | 'installment') => {
    setQuickExpenseFocus({ cardId: card.id, mode, nonce: Date.now() })
    setSection('islemler')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const transactionTarget = movementAccounts.find((card) => card.id === transactionTargetCard)
  const transactionTargetAccounts = movementAccounts.filter((card) => card.id !== transactionCard?.id)
  const transactionAmountValue = parseNumber(transactionAmount)

  return (
    <>
      <CrudPage
        table="cards"
        pageTitle="Hesaplar ve kartlar"
        addLabel="Hesap / kart ekle"
        fields={fields}
        emptyTitle="Henüz kart yok"
        emptyDescription="Banka hesaplarını ve kredi kartlarını buradan takip edebilirsin."
        orderBy="card_type"
        showList={section === 'kartlar'}
        renderBeforeList={({ loading, rows, reload, setError }) => {
          const cardRows = rows as Card[]
          const counts: Partial<Record<CardSection, number>> = {
            kartlar: cardRows.length,
            ekstreler:
              statements.filter((statement) => statement.status === 'open').length +
              provisions.filter((expense) => expense.status === 'provision').length,
          }

          return (
            <div className="flex flex-col gap-3">
              <CardSectionNav section={section} onSelect={handleSectionChange} counts={counts} />
              {!loading ? (
                <DueStatementAutomation rows={cardRows} reload={reload} loadStatements={loadStatements} setError={setError} />
              ) : null}

              {!loading && section === 'ozet' ? (
                <>
                  <AccountHubPanel rows={cardRows} onOpenTransfer={(source) => openTransaction(source, reload, cardRows, 'transfer')} />
                  <CreditCardOverview rows={cardRows} />
                </>
              ) : null}

              {!loading && section === 'islemler' ? (
                <>
                  <QuickExpensePanel rows={cardRows} reload={() => refreshCardsAndProvisions(reload)} setError={setError} focus={quickExpenseFocus} />
                  <CardInstallmentExpensesPanel
                    cards={cardRows}
                    reload={() => refreshCardsAndProvisions(reload)}
                    setError={setError}
                  />
                  {cardRows.some((row) => row.card_type === 'kredi_karti') ? (
                    <details className="rounded-lg border border-border/75 bg-card/80 p-3 shadow-sm">
                      <summary className="cursor-pointer text-sm font-bold text-foreground">Eski taksit devri</summary>
                      <div className="mt-3">
                        <LegacyInstallmentPanel rows={cardRows} reload={reload} setError={setError} />
                      </div>
                    </details>
                  ) : null}
                </>
              ) : null}

              {!loading && section === 'ekstreler' ? (
                <>
                  {statementError ? (
                    <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">{statementError}</p>
                  ) : null}
                  <StatementPanel
                    rows={cardRows}
                    statements={statements}
                    loading={statementsLoading}
                    actionId={statementActionId}
                    onPay={(statement, card) => openStatementPayment(statement, card, cardRows, reload)}
                  />
                  {provisionError ? (
                    <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">{provisionError}</p>
                  ) : null}
                  <ProvisionPanel
                    rows={cardRows}
                    provisions={provisions}
                    loading={provisionsLoading}
                    actionId={provisionActionId}
                    onPost={(expense, amount) => void handleProvisionAction(expense, 'post', reload, setError, amount)}
                    onPostAll={(expenses) => void handlePostAllProvisions(expenses, reload, setError)}
                    onCancel={(expense) => void handleProvisionAction(expense, 'cancel', reload, setError)}
                  />
                  <CardInstallmentCalendarPanel cards={cardRows} />
                </>
              ) : null}
            </div>
          )
        }}
        getInitialValues={(row?: Card) => ({
          bank_name: row?.bank_name ?? '',
          card_name: row?.card_name ?? '',
          card_type: row?.card_type ?? 'kredi_karti',
          holder_name: row?.holder_name ?? '',
          limit_group_name: row?.limit_group_name ?? '',
          current_balance: row?.current_balance ?? 0,
          credit_limit: row?.credit_limit ?? 0,
          statement_debt_amount: row?.statement_debt_amount ?? row?.debt_amount ?? 0,
          current_period_spending: row?.current_period_spending ?? 0,
          provision_amount: row?.provision_amount ?? 0,
          statement_day: row?.statement_day ?? '',
          due_day: row?.due_day ?? '',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId) => {
          const cardType = formData.get('card_type') as Card['card_type']
          const isCreditCard = cardType === 'kredi_karti'
          const statementDebt = isCreditCard ? parseNumber(formData.get('statement_debt_amount')) : 0
          const currentPeriod = isCreditCard ? parseNumber(formData.get('current_period_spending')) : 0
          const provisionAmount = isCreditCard ? parseNumber(formData.get('provision_amount')) : 0

          return {
            user_id: userId,
            bank_name: String(formData.get('bank_name') ?? ''),
            card_name: String(formData.get('card_name') ?? ''),
            card_type: cardType,
            holder_name: isCreditCard ? String(formData.get('holder_name') ?? '').trim() || null : null,
            limit_group_name: isCreditCard ? String(formData.get('limit_group_name') ?? '').trim() || null : null,
            current_balance: isCreditCard ? 0 : parseNumber(formData.get('current_balance')),
            credit_limit: isCreditCard ? parseNumber(formData.get('credit_limit')) : 0,
            debt_amount: isCreditCard ? cardSplitTotal(statementDebt, currentPeriod, provisionAmount) : 0,
            statement_debt_amount: statementDebt,
            current_period_spending: currentPeriod,
            provision_amount: provisionAmount,
            statement_day: isCreditCard ? optionalDay(formData.get('statement_day')) : null,
            due_day: isCreditCard ? optionalDay(formData.get('due_day')) : null,
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.card_name}
        renderSubtitle={(row) => `${row.bank_name} · ${cardTypeLabel(row.card_type)}`}
        renderDetails={(row) =>
          row.card_type === 'kredi_karti'
            ? [
                row.holder_name ? `Kart sahibi: ${row.holder_name}` : 'Kart sahibi: -',
                row.limit_group_name ? `Ortak limit: ${row.limit_group_name}` : 'Ortak limit: -',
                `Limit: ${formatCurrency(row.credit_limit)}`,
                `Toplam borç: ${formatCurrency(row.debt_amount)}`,
                `Ekstre borcu: ${formatCurrency(row.statement_debt_amount)}`,
                `Dönem içi kesinleşen: ${formatCurrency(row.current_period_spending)}`,
                `Provizyon: ${formatCurrency(cardProvisionAmount(row))}`,
                `Ekstre: ${row.statement_day ? `Her ayın ${row.statement_day}. günü` : '-'}`,
                `Son ödeme: ${row.due_day ? `Her ayın ${row.due_day}. günü` : '-'}`,
              ]
            : [`Bakiye: ${formatCurrency(row.current_balance)}`]
        }
        renderCard={(row, helpers) => (
          <CreditAccountListCard
            row={row as Card}
            rows={helpers.rows as Card[]}
            statements={statements}
            installments={installments}
            menu={helpers.menu}
            rowActions={helpers.rowActions}
            reload={helpers.reload}
            setError={helpers.setError}
            onTransfer={(source) => openTransaction(source, helpers.reload, helpers.rows as Card[], 'transfer')}
            onPayDebt={openDebtPayment}
            onCutStatement={cutStatement}
            onAddExpense={focusQuickExpense}
          />
        )}
        renderExtra={(row, helpers) => {
          if (row.card_type !== 'kredi_karti' || row.credit_limit <= 0) return null

          const stats = limitGroupStats(row, helpers.rows as Card[])
          return (
            <div className="mt-3 rounded-xl border border-border/50 bg-muted/30 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{stats.isShared ? 'Ortak limit kullanımı' : 'Limit kullanımı'}</span>
                <span className="font-mono font-semibold tabular-nums text-foreground">{Math.round(stats.usageRate)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-info transition-all duration-500"
                  style={{ width: `${stats.usageRate}%` }}
                />
              </div>
              {stats.isShared ? (
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground min-[430px]:grid-cols-3">
                  <span>Grup borcu: {formatCurrency(stats.totalDebt)}</span>
                  <span>Provizyon: {formatCurrency(stats.provisionAmount)}</span>
                  <span>Kalan limit: {formatCurrency(stats.availableLimit)}</span>
                </div>
              ) : null}
            </div>
          )
        }}
        getCardClassName={() =>
          'border-[hsl(var(--bank-hue)_52%_78%)] bg-[hsl(var(--bank-hue)_58%_98%)] dark:border-[hsl(var(--bank-hue)_42%_34%)] dark:bg-[hsl(var(--bank-hue)_38%_15%)]'
        }
        getDetailClassName={() => 'bg-[hsl(var(--bank-hue)_46%_96%)] dark:bg-[hsl(var(--bank-hue)_34%_20%)]'}
        getCardStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        getDetailStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        groupBy={(row) => cardGroupLabel(row)}
        renderMenuActions={(row, helpers) =>
          row.card_type === 'kredi_karti' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  openDebtPayment(row, helpers.reload, helpers.rows as Card[])
                  helpers.closeMenu()
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                <ReceiptText size={14} />
                Borç öde
              </button>
              <button
                type="button"
                onClick={() => {
                  helpers.closeMenu()
                  void cutStatement(row, helpers.reload, helpers.setError)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                <ReceiptText size={14} />
                Ekstre kes
              </button>
            </>
          ) : null
        }
        renderRowActions={(row, helpers) =>
          row.card_type === 'banka_karti' ? (
            <button
              type="button"
              onClick={() => openTransaction(row, helpers.reload, helpers.rows as Card[])}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.97]"
            >
              İşlem
            </button>
          ) : null
        }
      />

      <SimpleModal title="Banka hesabı işlemi" open={Boolean(transactionCard)} onClose={() => setTransactionCard(null)}>
        <form onSubmit={handleTransactionSubmit} className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{transactionCard?.card_name}</p>
            <p>Mevcut bakiye: {formatCurrency(transactionCard?.current_balance ?? 0)}</p>
          </div>
          <label className="block text-sm font-semibold text-foreground">
            İşlem tipi
            <select
              value={transactionType}
              onChange={(event) => {
                setTransactionType(event.target.value as 'in' | 'out' | 'transfer')
                setTransactionTargetCard('')
                setTransactionError('')
              }}
              className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
            >
              <option value="in">Para geldi</option>
              <option value="out">Para gitti</option>
              <option value="transfer">Hesaplar arası transfer</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Tutar
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={transactionAmount}
              onChange={(event) => setTransactionAmount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-input px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
            />
          </label>
          {transactionType === 'transfer' ? (
            <>
              <label className="block text-sm font-semibold text-foreground">
                Hedef hesap
                <select
                  required
                  value={transactionTargetCard}
                  onChange={(event) => {
                    setTransactionTargetCard(event.target.value)
                    setTransactionError('')
                  }}
                  className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
                >
                  <option value="">{transactionTargetAccounts.length > 0 ? 'Hedef hesap seç' : 'Transfer için ikinci hesap gerekli'}</option>
                  {transactionTargetAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bank_name} · {account.card_name} ({formatCurrency(account.current_balance)})
                    </option>
                  ))}
                </select>
              </label>
              {transactionTarget ? (
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Kaynak sonrası: {formatCurrency((transactionCard?.current_balance ?? 0) - transactionAmountValue)}
                  </span>
                  <span>Hedef sonrası: {formatCurrency(transactionTarget.current_balance + transactionAmountValue)}</span>
                </div>
              ) : null}
            </>
          ) : null}
          {transactionError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{transactionError}</p> : null}
          <button
            type="submit"
            disabled={transactionSaving}
            className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
          >
            {transactionSaving ? 'İşleniyor...' : transactionType === 'transfer' ? 'Transferi tamamla' : 'Bakiyeyi güncelle'}
          </button>
        </form>
      </SimpleModal>

      <SimpleModal title="Kredi kartı borç ödeme" open={Boolean(debtPaymentCard)} onClose={() => setDebtPaymentCard(null)}>
        <form onSubmit={handleDebtPaymentSubmit} className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{debtPaymentCard?.card_name}</p>
            <p>Ekstre borcu: {formatCurrency(debtPaymentCard?.statement_debt_amount ?? 0)}</p>
            <p>Toplam borç: {formatCurrency(debtPaymentCard?.debt_amount ?? 0)}</p>
            <p>Ödenebilir: {formatCurrency(debtPaymentCard ? cardPayableDebt(debtPaymentCard) : 0)}</p>
          </div>
          <MoneyInput label="Ödeme tutarı" value={debtPaymentAmount} onValueChange={setDebtPaymentAmount} required />
          <AccountSelector
            accounts={allCards}
            value={debtPaymentSourceCard}
            onChange={setDebtPaymentSourceCard}
            amount={parseNumber(debtPaymentAmount)}
          />
          {debtPaymentError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{debtPaymentError}</p> : null}
          <button
            type="submit"
            disabled={debtPaymentSaving}
            className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
          >
            {debtPaymentSaving ? 'İşleniyor...' : 'Borç öde'}
          </button>
        </form>
      </SimpleModal>

      <SimpleModal title="Ekstre odemesi" open={Boolean(statementPayment)} onClose={closeStatementPayment}>
        <form onSubmit={handleStatementPaymentSubmit} className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{statementPayment?.card.card_name}</p>
            <p>Ekstre: {statementPayment ? statementPeriodLabel(statementPayment.statement) : '-'}</p>
            <p>Son odeme: {statementPayment ? formatDate(statementPayment.statement.due_date) : '-'}</p>
            <p>Tutar: {formatCurrency(statementPayment?.statement.statement_debt_amount ?? 0)}</p>
          </div>
          <AccountSelector
            accounts={statementPaymentAccounts}
            value={statementPaymentSourceCard}
            onChange={setStatementPaymentSourceCard}
            amount={statementPayment?.statement.statement_debt_amount ?? 0}
          />
          <p className="rounded-xl border border-success/20 bg-success/8 p-3 text-xs font-medium text-success">
            Bu ekstre kapandiginda ekstreye bagli kredi karti taksitleri otomatik odendi olur. Taksitler net borca ayrica eklenmez.
          </p>
          {statementPaymentError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{statementPaymentError}</p> : null}
          <button
            type="submit"
            disabled={statementPaymentSaving}
            className="h-12 w-full rounded-xl bg-success px-4 text-sm font-semibold text-success-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--success)_28%,transparent)] transition hover:bg-success/90 active:scale-[0.99] disabled:opacity-50"
          >
            {statementPaymentSaving ? 'Isleniyor...' : 'Ekstreyi odendi isaretle'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
