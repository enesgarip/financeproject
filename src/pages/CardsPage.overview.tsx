import { ArrowRightLeft } from 'lucide-react'
import { HeroNumber, LineGroup, SectionEyebrow, SERIT_TEXT, useSeritAmount } from '../components/serit'
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
    <div className="min-w-0 rounded-lg bg-page px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1">
        <p className="truncate text-[11px] font-medium text-ink-muted">{label}</p>
        {help ? <HelpTooltip title={label} content={help} /> : null}
      </div>
      <p className="mt-1 truncate text-sm font-bold tabular-nums text-ink">{value}</p>
    </div>
  )
}

export function CardDatum({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warning' | 'danger' }) {
  const valueClass = {
    neutral: 'text-ink',
    good: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  }[tone]

  // `LineGroup` içinde yaşar: ayıracı kap çizer, satır kendi zeminini bilmez.
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-[11px]">
      <p className="min-w-0 truncate text-[13px] text-ink-muted">{label}</p>
      <p className={`serit-num shrink-0 truncate text-[15px] font-semibold ${valueClass}`}>{value}</p>
    </div>
  )
}
import { buildLimitGroupSummaries } from './CardsPage.helpers'

export function CreditCardOverview({
  rows,
  formatAmount = formatCurrency,
}: {
  rows: Card[]
  formatAmount?: (value: number | null | undefined) => string
}) {
  const groups = buildLimitGroupSummaries(rows)
  const bankCards = rows.filter((row) => row.card_type === 'banka_karti')
  if (groups.length === 0) return null

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
            <div className="inline-flex items-center gap-1 text-ink-muted">
              <HelpTooltip title="Kart özeti" content={cardHelp.summary} />
              <StatusBadge tone={totalUsageRate >= 80 ? 'danger' : totalUsageRate >= 55 ? 'warning' : 'good'}>%{Math.round(totalUsageRate)}</StatusBadge>
            </div>
          }
        />
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-end">
          <div className="min-w-0">
            <AmountDisplay label="Toplam kart borcu" value={formatAmount(totalDebt)} tone={totalDebt > 0 ? 'warning' : 'good'} size="lg" />
            <div className="mt-4">
              <ProgressStrip label="Limit kullanımı" value={totalUsageRate} tone={totalUsageRate >= 80 ? 'danger' : totalUsageRate >= 55 ? 'warning' : 'good'} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-3">
            <MiniStat label="Ekstre borcu" value={formatAmount(totalStatementDebt)} tone={totalStatementDebt > 0 ? 'warning' : 'good'} />
            <MiniStat label="Dönem içi" value={formatAmount(totalCurrentPeriod)} tone="info" />
            <MiniStat label="Provizyon" value={formatAmount(totalProvision)} tone={totalProvision > 0 ? 'warning' : 'neutral'} />
            <MiniStat label="Kalan limit" value={formatAmount(totalAvailable)} tone="good" />
            <MiniStat label="Limit" value={formatAmount(totalLimit)} tone="neutral" />
            <MiniStat label="Hesap bakiyesi" value={formatAmount(cashBalance)} tone="premium" />
          </div>
        </div>
      </FinancePanel>

      {groups.length > 0 ? (
        <div className="flex snap-x gap-3 overflow-x-auto pb-1">
          {groups.map((group) => (
            <SurfaceCard key={group.key} className="min-w-[86%] snap-start border-line-strong min-[520px]:min-w-[48%]">
              <CardHeader className="pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <BankLogo bankName={group.bankName} size="sm" />
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{group.label}</CardTitle>
                      <p className="mt-1 truncate text-xs text-ink-muted">{group.bankName}</p>
                    </div>
                  </div>
                  <Badge variant="secondary">{group.cards.length} kart</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-1">
                <div className="grid grid-cols-2 gap-2 text-xs min-[460px]:grid-cols-4">
                  <OverviewStat label="Toplam" value={formatAmount(group.debt)} help={cardHelp.totalDebt} />
                  <OverviewStat label="Ekstre" value={formatAmount(group.statementDebt)} help={cardHelp.statementDebt} />
                  <OverviewStat label="Dönem içi" value={formatAmount(group.currentPeriod)} help={cardHelp.currentPeriod} />
                  <OverviewStat label="Provizyon" value={formatAmount(group.provision)} help={cardHelp.provision} />
                </div>
                <Progress value={group.usageRate} className="h-1.5" />
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span>Limit {formatAmount(group.limit)}</span>
                  <span>Kalan {formatAmount(group.available)}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {group.cards.map((card) => (
                    <div key={card.id} className="flex items-center justify-between gap-2 rounded-lg bg-page px-2.5 py-2 text-xs">
                      <span className="min-w-0 truncate font-semibold text-ink">
                        {card.holder_name || card.card_name}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {formatAmount(card.debt_amount)}
                        {cardProvisionAmount(card) > 0 ? ` · prov. ${formatAmount(cardProvisionAmount(card))}` : ''}
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
  // Tutarlar gizlilik maskesine saygılı Şerit biçimlendiricisinden geçer;
  // panel artık dışarıdan formatAmount almıyor (iki biçim yan yana düşüyordu).
  const seritAmount = useSeritAmount()
  const accounts = rows.filter((row) => row.card_type === 'banka_karti')
  const creditCards = rows.filter((row) => row.card_type === 'kredi_karti')
  if (accounts.length === 0 && creditCards.length === 0) return null

  const accountBalance = sumTL(accounts.map((account) => account.current_balance))
  const cardDebt = sumTL(creditCards.map((card) => card.debt_amount))
  const payableCardDebt = sumTL(creditCards.map((card) => cardPayableDebt(card)))
  const balanceAfterPayableDebt = diffTL(accountBalance, payableCardDebt)
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

  // Şerit (`4a`): kahraman = borç sonrası likit; altında banka hesapları çizgi
  // listesi. Kart yok — "accounts-signature-hub" gradyanlı bloğu kaldırıldı.
  return (
    <section id="hesap-merkezi">
      <HeroNumber
        label="Likit toplam"
        value={balanceAfterPayableDebt}
        tone={balanceAfterPayableDebt >= 0 ? 'ink' : 'danger'}
        description={
          <>
            Kart borcu düşülmüş net ·{' '}
            <span className="serit-num text-ink">{seritAmount(accountBalance).amount} ₺</span> hesap bakiyesi,{' '}
            <span className="serit-num" style={{ color: SERIT_TEXT.danger }}>
              {seritAmount(payableCardDebt).amount} ₺
            </span>{' '}
            ödenebilir borç
          </>
        }
      />

      <div className="mt-6">
        <SectionEyebrow className="mb-1">
          Banka hesapları · {banks.length} banka
        </SectionEyebrow>

        {accounts.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-muted">Transfer için önce banka kartı türünde en az iki hesap ekle.</p>
        ) : (
          <LineGroup>
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 py-[13px]">
                <div className="flex min-w-0 items-center gap-3">
                  <BankLogo bankName={account.bank_name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-semibold text-ink">{account.card_name}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">{account.bank_name}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="serit-num text-[17px] font-semibold text-ink">
                    {seritAmount(account.current_balance).amount} ₺
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenTransfer(account)}
                    disabled={!canTransfer}
                    className="grid size-9 place-items-center rounded-lg border border-line-strong text-ink-faint transition-colors duration-[120ms] hover:bg-black/[.02] hover:text-ink disabled:opacity-45 dark:hover:bg-white/[.03]"
                    aria-label={`${account.card_name} hesabından transfer yap`}
                  >
                    <ArrowRightLeft size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </LineGroup>
        )}
      </div>

      {cardDebt > 0 ? (
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-muted">
          Kredi kartlarında toplam <span className="serit-num font-semibold text-ink">{seritAmount(cardDebt).amount} ₺</span> borç,
          bugün ödenebilir kısmı <span className="serit-num font-semibold text-ink">{seritAmount(payableCardDebt).amount} ₺</span>.
        </p>
      ) : null}
    </section>
  )
}
