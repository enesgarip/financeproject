import { CrudPage, type FormField } from '../components/CrudPage'
import { AccountSelector } from '../components/finance/AccountSelector'
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
    <Card variant="elevated" className="overflow-hidden">
      <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-destructive via-primary to-success opacity-80" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="finance-label">Borç Dengesi</p>
            <p className={`finance-value mt-1.5 text-[clamp(1.5rem,6vw,2.1rem)] font-bold leading-none ${net >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(Math.abs(net))}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{net >= 0 ? 'Net alacak' : 'Net borç'}</p>
          </div>
          <Badge variant={net >= 0 ? 'success' : 'destructive'}>{openRows.length} açık kayıt</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <OverviewStat label="Borç" value={formatCurrency(borrowed)} tone="danger" />
          <OverviewStat label="Alacak" value={formatCurrency(receivable)} tone="success" />
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
        pageTitle="Kişiler"
        addLabel="Borç / alacak ekle"
        fields={fields}
        emptyTitle="Henüz kişi kaydı yok"
        emptyDescription="Kişisel borçlarını ve alacaklarını buradan takip edebilirsin."
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
        renderSubtitle={(row) => `${directionLabel(row.direction)} · ${valueTypeLabel(row)} · ${row.status}`}
        renderDetails={(row) => {
          const details = [`Değer: ${formatCurrency(row.estimated_value_try)}`, `Vade: ${formatDate(row.due_date)}`]
          if (isGoldDebt(row)) details.unshift(`Miktar: ${formatNumber(row.amount)} ${valueTypeLabel(row)}`)
          if (row.value_type === 'doviz') details.unshift(`Para birimi: ${row.currency ?? '-'}`)
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

      <SimpleModal title={settlementIsBorrowed ? 'Borcu öde' : 'Alacağı tahsil et'} open={Boolean(debtToSettle)} onClose={closeDebtSettlement}>
        <form onSubmit={handleDebtSettlementSubmit} className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{debtToSettle?.person_name}</p>
            <p className="mt-0.5">Tutar: <span className="font-mono font-semibold text-foreground">{formatCurrency(debtToSettle?.estimated_value_try ?? 0)}</span></p>
            <p className="mt-0.5">{settlementIsBorrowed ? 'Bu tutar seçilen hesaptan düşer.' : 'Bu tutar seçilen hesaba eklenir.'}</p>
          </div>
          <AccountSelector
            accounts={debtCards}
            value={debtAccountCard}
            onChange={setDebtAccountCard}
            amount={settlementIsBorrowed ? debtToSettle?.estimated_value_try ?? 0 : -(debtToSettle?.estimated_value_try ?? 0)}
            label={settlementIsBorrowed ? 'Kaynak hesap' : 'Tahsilat hesabı'}
          />
          {debtPaymentError ? (
            <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{debtPaymentError}</p>
          ) : null}
          <button
            type="submit"
            disabled={debtPaymentSaving}
            className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
          >
            {debtPaymentSaving ? 'İşleniyor...' : settlementIsBorrowed ? 'Borcu öde' : 'Tahsilatı tamamla'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
