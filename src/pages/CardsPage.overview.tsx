import { ArrowRightLeft } from 'lucide-react'
import { BankLogo } from '../components/finance/BankLogo'
import { AmountDisplay, FinancePanel, MiniStat, ProgressStrip, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../components/ui/help-tooltip'
import { Progress } from '../components/ui/progress'
import type { Card } from '../types/database'
import { cardPayableDebt, cardProvisionAmount } from '../utils/financeSummary'
import { formatCurrency } from '../utils/formatCurrency'
import { diffTL, sumTL } from '../utils/money'
import { cardHelp } from './CardsPage.help'

export function OverviewStat({ label, value, help }: { label: string; value: string; help?: HelpTooltipContent }) {
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

export function CardDatum({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warning' | 'danger' }) {
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
import { buildLimitGroupSummaries } from './CardsPage.helpers'

export function CreditCardOverview({ rows }: { rows: Card[] }) {
  const groups = buildLimitGroupSummaries(rows)
  const bankCards = rows.filter((row) => row.card_type === 'banka_karti')
  if (groups.length === 0 && bankCards.length === 0) return null

  const totalLimit = sumTL(groups.map((group) => group.limit))
  const totalDebt = sumTL(groups.map((group) => group.debt))
  const totalStatementDebt = sumTL(groups.map((group) => group.statementDebt))
  const totalCurrentPeriod = sumTL(groups.map((group) => group.currentPeriod))
  const totalProvision = sumTL(groups.map((group) => group.provision))
  const totalAvailable = Math.max(0, diffTL(totalLimit, totalDebt))
  const totalUsageRate = totalLimit > 0 ? Math.min(100, (totalDebt / totalLimit) * 100) : 0
  const cashBalance = sumTL(bankCards.map((card) => card.current_balance))

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

  const accountBalance = sumTL(accounts.map((account) => account.current_balance))
  const cardDebt = sumTL(creditCards.map((card) => card.debt_amount))
  const payableCardDebt = sumTL(creditCards.map((card) => cardPayableDebt(card)))
  const banks = Array.from(
    accounts.reduce((map, account) => {
      const current = map.get(account.bank_name) ?? { balance: 0, count: 0 }
      map.set(account.bank_name, {
        balance: sumTL([current.balance, account.current_balance]),
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
