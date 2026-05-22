import { CrudPage, type FormField } from '../components/CrudPage'
import { SimpleModal } from '../components/SimpleModal'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { supabase } from '../lib/supabase'
import type { Card as FinanceCard, Debt } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatCurrency'
import { useState } from 'react'

const fields: FormField[] = [
  { name: 'person_name', label: 'Kişi', type: 'text', required: true },
  {
    name: 'direction',
    label: 'Yön',
    type: 'select',
    options: [
      { label: 'Borç aldım', value: 'borç_aldım' },
      { label: 'Borç verdim', value: 'borç_verdim' },
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
    name: 'amount',
    label: 'Miktar',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'value_type', value: ['gram_altin', 'ceyrek_altin'] },
  },
  {
    name: 'estimated_value_try',
    label: 'Tahmini değer (TRY)',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
  },
  { name: 'due_date', label: 'Vade tarihi', type: 'date' },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function optionalDate(value: FormDataEntryValue | null) {
  const date = String(value ?? '')
  return date || null
}

function directionLabel(value: Debt['direction']) {
  return value === 'borç_aldım' ? 'Borç aldım' : 'Borç verdim'
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

const debtTone: Record<Debt['direction'], { card: string; detail: string; group: string }> = {
  borç_aldım: {
    card: 'border-rose-200 bg-rose-50/35 dark:border-rose-900 dark:bg-rose-950/25',
    detail: 'bg-rose-50 dark:bg-rose-950/40',
    group: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  },
  borç_verdim: {
    card: 'border-emerald-200 bg-emerald-50/35 dark:border-emerald-900 dark:bg-emerald-950/25',
    detail: 'bg-emerald-50 dark:bg-emerald-950/40',
    group: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  },
}

function DebtsOverview({ rows }: { rows: Debt[] }) {
  const openRows = rows.filter((row) => row.status === 'açık')
  if (openRows.length === 0) return null

  const borrowed = openRows
    .filter((row) => row.direction === 'borç_aldım')
    .reduce((sum, row) => sum + row.estimated_value_try, 0)
  const receivable = openRows
    .filter((row) => row.direction === 'borç_verdim')
    .reduce((sum, row) => sum + row.estimated_value_try, 0)
  const total = borrowed + receivable
  const net = receivable - borrowed
  const borrowedRate = total > 0 ? Math.min(100, (borrowed / total) * 100) : 0
  const upcoming = openRows
    .filter((row) => row.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0]

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase text-muted-foreground">Borç dengesi</p>
            <p className={`mt-1 text-2xl font-extrabold tabular-nums ${net >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
              {formatCurrency(Math.abs(net))}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{net >= 0 ? 'Net alacak' : 'Net borç'}</p>
          </div>
          <Badge variant={net >= 0 ? 'default' : 'destructive'}>{openRows.length} açık</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <OverviewStat label="Borç" value={formatCurrency(borrowed)} tone="rose" />
          <OverviewStat label="Alacak" value={formatCurrency(receivable)} tone="emerald" />
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
            <span>Borç ağırlığı</span>
            <span>%{Math.round(borrowedRate)}</span>
          </div>
          <Progress value={borrowedRate} className="h-1.5" />
        </div>
        {upcoming?.due_date ? (
          <div className="mt-3 rounded-xl bg-muted/55 px-3 py-2 text-sm">
            <span className="font-semibold text-foreground">{upcoming.person_name}</span>
            <span className="text-muted-foreground"> · en yakın vade {formatDate(upcoming.due_date)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function OverviewStat({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'

  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2">
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-sm font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}

async function getBankaKartlari(): Promise<FinanceCard[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('card_type', 'banka_karti')

  if (error) return []
  return (data as FinanceCard[]) ?? []
}

export function DebtsPage() {
  const [debtToSettle, setDebtToSettle] = useState<Debt | null>(null)
  const [debtCards, setDebtCards] = useState<FinanceCard[]>([])
  const [debtAccountCard, setDebtAccountCard] = useState('')
  const [debtPaymentError, setDebtPaymentError] = useState('')
  const [debtPaymentSaving, setDebtPaymentSaving] = useState(false)
  const [reloadDebts, setReloadDebts] = useState<(() => Promise<void>) | null>(null)

  async function openDebtSettlement(debt: Debt, reload: () => Promise<void>) {
    const cards = await getBankaKartlari()
    setDebtToSettle(debt)
    setDebtCards(cards)
    setDebtAccountCard('')
    setDebtPaymentError(cards.length === 0 ? 'İşlem için önce bir banka kartı hesabı eklemelisin.' : '')
    setReloadDebts(() => reload)
  }

  function closeDebtSettlement() {
    setDebtToSettle(null)
    setDebtAccountCard('')
    setDebtPaymentError('')
  }

  async function handleDebtSettlementSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!debtToSettle) return

    if (!debtAccountCard) {
      setDebtPaymentError('Hesap seçmelisin.')
      return
    }

    const accountCard = debtCards.find((card) => card.id === debtAccountCard)
    if (!accountCard) {
      setDebtPaymentError('Hesap bulunamadı.')
      return
    }

    if (debtToSettle.direction === 'borç_aldım' && accountCard.current_balance < debtToSettle.estimated_value_try) {
      setDebtPaymentError('Kaynak hesap bakiyesi yetersiz.')
      return
    }

    setDebtPaymentSaving(true)
    setDebtPaymentError('')

    const { error } = await supabase.rpc('settle_personal_debt', {
      p_debt_id: debtToSettle.id,
      p_account_card_id: accountCard.id,
    })

    setDebtPaymentSaving(false)
    if (error) {
      setDebtPaymentError(error.message)
      return
    }

    closeDebtSettlement()
    await reloadDebts?.()
  }

  const settlementIsBorrowed = debtToSettle?.direction === 'borç_aldım'

  return (
    <>
      <CrudPage
        table="debts"
        pageTitle="Borç / Alacak"
        addLabel="Borç ekle"
        fields={fields}
        emptyTitle="Henüz borç kaydı yok"
        emptyDescription="Kişisel borçlarını ve alacaklarını sade şekilde takip edebilirsin."
        orderBy="due_date"
        renderBeforeList={({ loading, rows }) => (!loading ? <DebtsOverview rows={rows as Debt[]} /> : null)}
        getInitialValues={(row?: Debt) => ({
          person_name: row?.person_name ?? '',
          direction: row?.direction ?? 'borç_aldım',
          value_type: row?.value_type ?? 'TRY',
          currency: row?.currency ?? 'USD',
          amount: row?.amount ?? 0,
          estimated_value_try: row?.estimated_value_try ?? 0,
          due_date: row?.due_date ?? '',
          status: row?.status ?? 'açık',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId, editing) => {
          const valueType = formData.get('value_type') as Debt['value_type']
          const isGold = valueType === 'gram_altin' || valueType === 'ceyrek_altin'

          return {
            user_id: userId,
            person_name: String(formData.get('person_name') ?? ''),
            direction: formData.get('direction') as Debt['direction'],
            value_type: valueType,
            currency: valueType === 'doviz' ? (formData.get('currency') as Debt['currency']) : valueType === 'TRY' ? 'TRY' : null,
            amount: isGold ? parseNumber(formData.get('amount')) : 1,
            estimated_value_try: parseNumber(formData.get('estimated_value_try')),
            due_date: optionalDate(formData.get('due_date')),
            status: editing?.status ?? 'açık',
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.person_name}
        renderSubtitle={(row) => `${valueTypeLabel(row)} · ${row.status}`}
        renderDetails={(row) => {
          const details = [`Değer: ${formatCurrency(row.estimated_value_try)}`, `Vade: ${formatDate(row.due_date)}`]
          if (isGoldDebt(row)) details.unshift(`Miktar: ${formatNumber(row.amount)} ${valueTypeLabel(row)}`)
          if (row.value_type === 'doviz') details.unshift(`Para birimi: ${row.currency ?? '-'}`)
          return details
        }}
        groupBy={(row) => directionLabel(row.direction)}
        getGroupClassName={() => 'text-stone-900 dark:text-stone-100'}
        getCardClassName={(row) => debtTone[row.direction].card}
        getDetailClassName={(row) => debtTone[row.direction].detail}
        renderRowActions={(row, helpers) =>
          row.status === 'açık' ? (
            <button
              type="button"
              onClick={() => void openDebtSettlement(row, helpers.reload)}
              className="max-w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              {row.direction === 'borç_aldım' ? 'Borcu öde' : 'Tahsil et'}
            </button>
          ) : null
        }
      />

      <SimpleModal title={settlementIsBorrowed ? 'Borcu öde' : 'Alacağı tahsil et'} open={Boolean(debtToSettle)} onClose={closeDebtSettlement}>
        <form onSubmit={handleDebtSettlementSubmit} className="space-y-4">
          <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            <p className="font-semibold text-stone-950 dark:text-stone-50">{debtToSettle?.person_name}</p>
            <p>Tutar: {formatCurrency(debtToSettle?.estimated_value_try ?? 0)}</p>
            <p>{settlementIsBorrowed ? 'Bu tutar seçilen hesaptan düşer.' : 'Bu tutar seçilen hesaba eklenir.'}</p>
          </div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            {settlementIsBorrowed ? 'Kaynak hesap' : 'Tahsilat hesabı'}
            <select
              required
              value={debtAccountCard}
              onChange={(event) => setDebtAccountCard(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              <option value="">Hesap seç</option>
              {debtCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.card_name} ({formatCurrency(card.current_balance)})
                </option>
              ))}
            </select>
          </label>
          {debtPaymentError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{debtPaymentError}</p> : null}
          <button
            type="submit"
            disabled={debtPaymentSaving}
            className="w-full rounded-xl bg-stone-700 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-stone-600"
          >
            {debtPaymentSaving ? 'İşleniyor...' : settlementIsBorrowed ? 'Borcu öde' : 'Tahsilatı tamamla'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
