import {
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CreditCard as CreditCardIcon,
  LayoutGrid,
  ReceiptText,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { BankLogo } from '../components/finance/BankLogo'
import { AmountDisplay, FinancePanel, MiniStat, ProgressStrip, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../components/ui/help-tooltip'
import { Progress } from '../components/ui/progress'
import { cutDueCardStatements } from '../data/repositories/cardsRepo'
import type { Card, CardExpense, CardStatementArchive } from '../types/database'
import { formatDate } from '../utils/date'
import { cardPayableDebt, cardProvisionAmount } from '../utils/financeSummary'
import { cn } from '../lib/utils'
import {
  buildLimitGroupSummaries,
  isSchemaCacheError,
  shouldRunStatementCut,
  statementPeriodLabel,
} from './CardsPage.helpers'
import { OverviewStat } from './CardsPage.atoms'
import { formatCurrency } from '../utils/formatCurrency'

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
      const cutResult = await cutDueCardStatements()

      if (!cutResult.ok) {
        if (!isSchemaCacheError(cutResult.error)) setError(cutResult.error.message ?? 'Ekstre kesimi başarısız.')
        return
      }

      if (!cancelled && cutResult.data > 0) {
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

