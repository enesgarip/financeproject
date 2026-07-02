import { CrudPage, type FormField } from '../components/CrudPage'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { RatesBanner } from '../components/finance/RatesBanner'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { useMarketRates } from '../hooks/useMarketRates'
import { useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import { fetchCardsByType } from '../data/repositories/cardsRepo'
import type { Card as FinanceCard, Debt } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import type { MarketRatesSnapshot } from '../utils/marketRates'
import { diffTL, sumTL } from '../utils/money'
import { debtRateSymbol, effectiveDebtValue, valueDebt } from '../utils/valuation'

/** Gold or non-TRY foreign-currency debts can be auto-valued from live rates. */
function debtSupportsAuto(values: Record<string, string>): boolean {
  if (values.value_type === 'gram_altin' || values.value_type === 'ceyrek_altin') return true
  return values.value_type === 'doviz' && Boolean(values.currency) && values.currency !== 'TRY'
}

function debtIsAuto(values: Record<string, string>): boolean {
  return debtSupportsAuto(values) && values.valuation === 'auto'
}

function valuationInputFromForm(values: Record<string, string>): Pick<Debt, 'value_type' | 'currency' | 'direction' | 'amount'> {
  return {
    value_type: (values.value_type as Debt['value_type']) ?? 'TRY',
    currency: (values.currency as Debt['currency']) ?? null,
    direction: (values.direction as Debt['direction']) ?? 'borç_aldım',
    amount: parseNumber(values.amount),
  }
}

function debtRateHint(values: Record<string, string>, context: unknown): string | null {
  const snapshot = context as MarketRatesSnapshot | null
  if (!snapshot) return null
  const input = valuationInputFromForm(values)
  const symbol = debtRateSymbol(input)
  const rate = symbol ? snapshot.rates[symbol] : undefined
  if (!rate) return null
  const price = input.direction === 'borç_aldım' ? rate.selling : rate.buying
  const unitLabel = input.value_type === 'gram_altin' ? 'gram' : input.value_type === 'ceyrek_altin' ? 'çeyrek' : input.currency
  return `1 ${unitLabel} ≈ ${formatCurrency(price)} (canlı)`
}

const fields: FormField[] = [
  { name: 'person_name', label: 'Kişi', type: 'text', required: true },
  {
    name: 'direction',
    label: 'Durum',
    type: 'select',
    options: [
      { label: 'Ben borçluyum', value: 'borç_aldım' },
      { label: 'Bana borçlu', value: 'borç_verdim' },
    ],
  },
  {
    name: 'value_type',
    label: 'Değer türü',
    type: 'select',
    options: [
      { label: 'Nakit (TRY)', value: 'TRY' },
      { label: 'Döviz', value: 'doviz' },
      { label: 'Gram altın', value: 'gram_altin' },
      { label: 'Çeyrek altın', value: 'ceyrek_altin' },
    ],
  },
  {
    name: 'currency',
    label: 'Para birimi',
    type: 'select',
    options: [
      { label: 'Dolar (USD)', value: 'USD' },
      { label: 'Euro (EUR)', value: 'EUR' },
      { label: 'Pound (GBP)', value: 'GBP' },
    ],
    visibleWhen: { field: 'value_type', value: 'doviz' },
  },
  {
    name: 'valuation',
    label: 'Değerleme',
    type: 'select',
    options: [
      { label: 'Otomatik (canlı kur)', value: 'auto' },
      { label: 'Manuel', value: 'manual' },
    ],
    visibleWhen: (values) => debtSupportsAuto(values),
  },
  {
    name: 'amount',
    label: 'Altın miktarı',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'value_type', value: ['gram_altin', 'ceyrek_altin'] },
    hint: debtRateHint,
  },
  {
    name: 'amount',
    label: 'Döviz tutarı',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: (values) => values.value_type === 'doviz' && Boolean(values.currency) && values.currency !== 'TRY',
    hint: debtRateHint,
  },
  {
    name: 'estimated_value_try',
    label: 'Tahmini değer (TRY)',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: (values) => !debtIsAuto(values),
  },
  {
    name: 'estimated_value_try_preview',
    label: 'Güncel değer (otomatik)',
    type: 'computed',
    visibleWhen: (values) => debtIsAuto(values),
    compute: (values, context) => valueDebt(valuationInputFromForm(values), context as MarketRatesSnapshot | null),
    formatComputed: (value) => (value === null ? 'Kur bekleniyor…' : formatCurrency(value)),
  },
  { name: 'due_date', label: 'Vade tarihi', type: 'date' },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function optionalDate(value: FormDataEntryValue | null) {
  const date = String(value ?? '')
  return date || null
}

function directionLabel(value: Debt['direction']) {
  return value === 'borç_aldım' ? 'Ben borçluyum' : 'Bana borçlu'
}

function valueTypeLabel(row: Debt) {
  if (row.value_type === 'TRY') return 'Nakit'
  if (row.value_type === 'doviz') return `Döviz${row.currency ? ` (${row.currency})` : ''}`
  if (row.value_type === 'gram_altin') return 'Gram altın'
  return 'Çeyrek altın'
}

function isGoldDebt(row: Debt) {
  return row.value_type === 'gram_altin' || row.value_type === 'ceyrek_altin'
}

const debtTone: Record<Debt['direction'], { card: string; detail: string }> = {
  borç_aldım: {
    card: 'border-destructive/20 bg-destructive/5 dark:bg-destructive/8',
    detail: 'bg-destructive/8 dark:bg-destructive/10',
  },
  borç_verdim: {
    card: 'border-success/20 bg-success/5 dark:bg-success/8',
    detail: 'bg-success/8 dark:bg-success/10',
  },
}

function DebtsOverview({ rows, snapshot }: { rows: Debt[]; snapshot: MarketRatesSnapshot | null }) {
  const { formatAmount } = useBalancePrivacy()
  const openRows = rows.filter((row) => row.status === 'açık')
  if (openRows.length === 0) return null

  const valueOf = (row: Debt) => effectiveDebtValue(row, snapshot)
  const borrowed = sumTL(openRows.filter((row) => row.direction === 'borç_aldım').map(valueOf))
  const receivable = sumTL(openRows.filter((row) => row.direction === 'borç_verdim').map(valueOf))
  const total = sumTL([borrowed, receivable])
  const net = diffTL(receivable, borrowed)
  const borrowedRate = total > 0 ? Math.min(100, (borrowed / total) * 100) : 0
  const upcoming = openRows
    .filter((row) => row.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0]

  return (
    <Card variant="elevated" className="overflow-hidden">
      <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-destructive via-primary to-success opacity-80" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="finance-label">Borç Dengesi</p>
            <p className={`finance-value mt-1.5 text-[clamp(1.5rem,6vw,2.1rem)] font-bold leading-none ${net >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatAmount(Math.abs(net))}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{net >= 0 ? 'Net alacak' : 'Net borç'}</p>
          </div>
          <Badge variant={net >= 0 ? 'success' : 'destructive'}>{openRows.length} açık kayıt</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <OverviewStat label="Borç" value={formatAmount(borrowed)} tone="danger" />
          <OverviewStat label="Alacak" value={formatAmount(receivable)} tone="success" />
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-muted-foreground">Borç ağırlığı</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">%{Math.round(borrowedRate)}</span>
          </div>
          <Progress value={borrowedRate} color="danger" size="default" />
        </div>
        {upcoming?.due_date ? (
          <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
            <span className="font-semibold text-foreground">{upcoming.person_name}</span>
            <span className="text-muted-foreground"> · en yakın vade {formatDate(upcoming.due_date)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function OverviewStat({ label, value, tone }: { label: string; value: string; tone: 'success' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-success' : 'text-destructive'

  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
      <p className="finance-label truncate">{label}</p>
      <p className={`finance-value mt-1 truncate text-sm font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}

async function getBankaKartlari(): Promise<FinanceCard[]> {
  const result = await fetchCardsByType('banka_karti')
  return result.ok ? result.data : []
}

export function DebtsPage() {
  const { formatAmount } = useBalancePrivacy()
  const { snapshot } = useMarketRates()
  const invalidateSnapshot = useInvalidateFinanceSnapshot()
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()

  async function openDebtSettlement(debt: Debt, reload: () => Promise<void>) {
    const isBorrowed = debt.direction === 'borç_aldım'
    await openPaymentDrawer(
      {
        id: `debt-${debt.id}`,
        kind: isBorrowed ? 'personal_debt' : 'personal_receivable',
        action: isBorrowed ? 'settle_debt' : 'collect_debt',
        sourceId: debt.id,
        title: debt.person_name,
        subtitle: isBorrowed ? 'Kişisel borç' : 'Beklenen tahsilat',
        date: debt.due_date ?? new Date().toISOString().slice(0, 10),
        amount: effectiveDebtValue(debt, snapshot),
        direction: isBorrowed ? 'outflow' : 'inflow',
        isEstimate: debt.auto_valued,
      },
      {
        loadCards: getBankaKartlari,
        reload,
        afterSuccess: invalidateSnapshot,
        detail: (
          <>
            <p className="font-semibold text-foreground">{debt.person_name}</p>
            <p className="mt-0.5">{isBorrowed ? 'Bu tutar seçilen hesaptan düşer.' : 'Bu tutar seçilen hesaba eklenir.'}</p>
          </>
        ),
      },
    )
  }

  return (
    <>
      <CrudPage
        table="debts"
        pageTitle="Kişiler"
        addLabel="Borç / alacak ekle"
        fields={fields}
        fieldContext={snapshot}
        emptyTitle="Henüz kişi kaydı yok"
        emptyDescription="Kişisel borçlarını ve alacaklarını buradan takip edebilirsin."
        orderBy="due_date"
        afterSave={async () => {
          await invalidateSnapshot()
        }}
        afterDelete={async () => {
          await invalidateSnapshot()
        }}
        renderBeforeList={({ loading, rows, reload }) => (
          <div className="space-y-3">
            <RatesBanner
              onSynced={async () => {
                await Promise.all([reload(), invalidateSnapshot()])
              }}
            />
            {!loading ? <DebtsOverview rows={rows as Debt[]} snapshot={snapshot} /> : null}
          </div>
        )}
        getInitialValues={(row?: Debt) => ({
          person_name: row?.person_name ?? '',
          direction: row?.direction ?? 'borç_aldım',
          value_type: row?.value_type ?? 'TRY',
          currency: row?.currency ?? 'USD',
          valuation: row ? (row.auto_valued ? 'auto' : 'manual') : 'auto',
          amount: row?.amount ?? 0,
          estimated_value_try: row?.estimated_value_try ?? 0,
          due_date: row?.due_date ?? '',
          status: row?.status ?? 'açık',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId, editing, context) => {
          const snapshotForSave = context as MarketRatesSnapshot | null
          const valueType = formData.get('value_type') as Debt['value_type']
          const isGold = valueType === 'gram_altin' || valueType === 'ceyrek_altin'
          const direction = formData.get('direction') as Debt['direction']
          const currency = valueType === 'doviz' ? (formData.get('currency') as Debt['currency']) : valueType === 'TRY' ? 'TRY' : null
          const foreignCash = valueType === 'doviz' && currency !== null && currency !== 'TRY'
          const supportsAuto = isGold || foreignCash
          const autoValued = supportsAuto && formData.get('valuation') === 'auto'
          const amount = isGold || foreignCash ? parseNumber(formData.get('amount')) : 1

          const manualValue = parseNumber(formData.get('estimated_value_try'))
          const autoValue = autoValued ? valueDebt({ value_type: valueType, currency, direction, amount }, snapshotForSave) : null

          return {
            user_id: userId,
            person_name: String(formData.get('person_name') ?? ''),
            direction,
            value_type: valueType,
            currency,
            amount,
            estimated_value_try: autoValue ?? manualValue,
            auto_valued: autoValued,
            due_date: optionalDate(formData.get('due_date')),
            status: editing?.status ?? 'açık',
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.person_name}
        renderSubtitle={(row) => `${directionLabel(row.direction)} · ${valueTypeLabel(row)} · ${row.status}`}
        renderDetails={(row) => {
          const details = [`Değer: ${formatAmount(effectiveDebtValue(row, snapshot))}`, `Vade: ${formatDate(row.due_date)}`]
          if (isGoldDebt(row)) details.unshift(`Miktar: ${formatNumber(row.amount)} ${valueTypeLabel(row)}`)
          if (row.value_type === 'doviz') {
            details.unshift(row.auto_valued ? `Tutar: ${formatNumber(row.amount)} ${row.currency ?? '-'}` : `Para birimi: ${row.currency ?? '-'}`)
          }
          if (row.auto_valued) details.push('Canlı kurla otomatik')
          return details
        }}
        groupBy={(row) => directionLabel(row.direction)}
        getCardClassName={(row) => debtTone[row.direction].card}
        getDetailClassName={(row) => debtTone[row.direction].detail}
        renderRowActions={(row, helpers) =>
          row.status === 'açık' ? (
            <button
              type="button"
              onClick={() => void openDebtSettlement(row, helpers.reload)}
              className="max-w-full rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--success)_28%,transparent)] transition hover:bg-success/90 active:scale-[0.97]"
            >
              {row.direction === 'borç_aldım' ? 'Borcu öde' : 'Tahsil et'}
            </button>
          ) : null
        }
      />

      <FinancePaymentDrawer {...drawerProps} />
    </>
  )
}
