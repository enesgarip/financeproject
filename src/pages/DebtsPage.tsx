import { CrudPage, type FormField } from '../components/CrudPage'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { RatesBanner } from '../components/finance/RatesBanner'
import { BreakdownBar, HeroNumber } from '../components/serit'
import { useMarketRates } from '../hooks/useMarketRates'
import { useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import { fetchCardsByType } from '../data/repositories/cardsRepo'
import type { Card as FinanceCard, Debt } from '../types/database'
import { dateInputValue, formatDate } from '../utils/date'
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import type { MarketRatesSnapshot } from '../utils/marketRates'
import { diffTL, sumTL } from '../utils/money'
import { valuationConfidence } from '../utils/dataConfidence'
import { debtRateSymbol, effectiveDebtValue, effectiveDebtValueWithSource, valueDebt } from '../utils/valuation'

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
  const openRows = rows.filter((row) => row.status === 'açık')
  if (openRows.length === 0) return null

  const valueOf = (row: Debt) => effectiveDebtValue(row, snapshot)
  const borrowed = sumTL(openRows.filter((row) => row.direction === 'borç_aldım').map(valueOf))
  const receivable = sumTL(openRows.filter((row) => row.direction === 'borç_verdim').map(valueOf))
  const total = sumTL([borrowed, receivable])
  const net = diffTL(receivable, borrowed)
  const upcoming = openRows
    .filter((row) => row.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0]

  // Şerit: kahraman = net borç/alacak dengesi, altında borç-alacak kırılımı.
  return (
    <section>
      <HeroNumber
        label={net >= 0 ? 'Net alacak' : 'Net borç'}
        value={Math.abs(net)}
        tone={net >= 0 ? 'brand' : 'danger'}
        description={
          <>
            {openRows.length} açık kayıt
            {upcoming?.due_date ? (
              <>
                {' '}· en yakın vade <span className="font-semibold text-ink">{upcoming.person_name}</span>,{' '}
                {formatDate(upcoming.due_date)}
              </>
            ) : null}
          </>
        }
      />

      {total > 0 ? (
        <div className="mt-[18px]">
          <BreakdownBar
            height={8}
            segments={[
              { label: 'Borç', value: borrowed, tone: 'danger' },
              { label: 'Alacak', value: receivable, tone: 'brand' },
            ]}
          />
        </div>
      ) : null}
    </section>
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
        date: debt.due_date ?? dateInputValue(new Date()),
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
            <p className="font-semibold text-ink">{debt.person_name}</p>
            <p className="mt-0.5">
              Toplam değer: <span className="font-mono font-semibold text-ink">{formatAmount(effectiveDebtValue(debt, snapshot))}</span>
            </p>
            <p className="mt-0.5">{isBorrowed ? 'Tam tutar hesaptan düşer; daha az girersen kısmi ödenir, kalan açık kalır.' : 'Tam tutar hesaba eklenir; daha az girersen kısmi tahsil edilir, kalan açık kalır.'}</p>
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
        pageLabel="Kişisel bakiye"
        pageDescription="Kimden alacaklı veya kime borçlu olduğunu vade ve ödeme durumuyla birlikte takip et."
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
          const { value, source } = effectiveDebtValueWithSource(row, snapshot)
          const details = [`Değer: ${formatAmount(value)}`, `Vade: ${formatDate(row.due_date)}`]
          if (isGoldDebt(row)) details.unshift(`Miktar: ${formatNumber(row.amount)} ${valueTypeLabel(row)}`)
          if (row.value_type === 'doviz') {
            details.unshift(row.auto_valued ? `Tutar: ${formatNumber(row.amount)} ${row.currency ?? '-'}` : `Para birimi: ${row.currency ?? '-'}`)
          }
          // "Canlı kurla otomatik" kur alınamadığında da yazıyordu — ekrandaki
          // rakam aslında saklı ve bayat olduğu halde canlı görünüyordu (Faz D3).
          if (row.auto_valued) {
            details.push(
              source === 'live'
                ? 'Canlı kurla otomatik'
                : `Kur alınamadı · ${valuationConfidence(source, row.valued_at).label}`,
            )
          }
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
              className="max-w-full rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success-foreground transition hover:bg-success/90 active:scale-[0.97]"
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
