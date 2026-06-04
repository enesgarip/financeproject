import { CrudPage, type FormField } from '../components/CrudPage'
import { AccountSelector } from '../components/finance/AccountSelector'
import { MoneyInput } from '../components/finance/MoneyInput'
import { SimpleModal } from '../components/SimpleModal'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { supabase } from '../lib/supabase'
import type { Card as FinanceCard, Payment, PaymentAmountStatus, PaymentCategory, PaymentMethod } from '../types/database'
import { daysUntil, formatDate } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { getLastUsed, resolvePreferred, setLastUsed } from '../utils/lastUsed'
import { useState } from 'react'

const paymentCategoryOptions: { label: PaymentCategory; value: PaymentCategory }[] = [
  { label: 'Fatura', value: 'Fatura' },
  { label: 'Dijital üyelik', value: 'Dijital üyelik' },
  { label: 'Kira / aidat', value: 'Kira / aidat' },
  { label: 'Sigorta', value: 'Sigorta' },
  { label: 'Vergi / devlet', value: 'Vergi / devlet' },
  { label: 'Eğitim', value: 'Eğitim' },
  { label: 'Sağlık', value: 'Sağlık' },
  { label: 'Diğer', value: 'Diğer' },
]

const paymentMethodOptions: { label: string; value: PaymentMethod }[] = [
  { label: 'Manuel ödeme', value: 'manual' },
  { label: 'Banka talimatı', value: 'bank_auto' },
]

const amountStatusOptions: { label: string; value: PaymentAmountStatus }[] = [
  { label: 'Kesin tutar', value: 'exact' },
  { label: 'Tahmini / beklenen', value: 'estimated' },
]

const fields: FormField[] = [
  { name: 'title', label: 'Başlık', type: 'text', required: true },
  {
    name: 'category',
    label: 'Kategori',
    type: 'select',
    options: paymentCategoryOptions,
  },
  {
    name: 'payment_method',
    label: 'Ödeme yöntemi',
    type: 'select',
    options: paymentMethodOptions,
  },
  {
    name: 'amount_status',
    label: 'Tutar durumu',
    type: 'select',
    options: amountStatusOptions,
  },
  { name: 'amount', label: 'Tutar / tahmin', type: 'number', min: '0', step: '0.01' },
  { name: 'due_date', label: 'Sıradaki tarih', type: 'date', required: true },
  {
    name: 'recurrence',
    label: 'Tekrar',
    type: 'select',
    options: [
      { label: 'Tek seferlik', value: 'none' },
      { label: 'Her ay', value: 'monthly' },
    ],
  },
  {
    name: 'recurrence_day',
    label: 'Her ayın günü',
    type: 'day',
    visibleWhen: { field: 'recurrence', value: 'monthly' },
  },
  {
    name: 'recurrence_end_date',
    label: 'Bitiş tarihi',
    type: 'date',
    visibleWhen: { field: 'recurrence', value: 'monthly' },
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function validatePaymentForm(formData: FormData) {
  const errors: Record<string, string> = {}
  const amount = parseNumber(formData.get('amount'))
  const paymentMethod = formData.get('payment_method')
  const amountStatus = formData.get('amount_status')
  const canWaitForActualAmount = paymentMethod === 'bank_auto' && amountStatus === 'estimated'
  if (amount < 0) errors.amount = 'Tutar negatif olamaz.'
  if (amount <= 0 && !canWaitForActualAmount) errors.amount = 'Tutar 0’dan büyük olmalı.'
  if (formData.get('recurrence') === 'monthly' && !formData.get('recurrence_day')) {
    errors.recurrence_day = 'Aylık ödeme için gün seç.'
  }
  return errors
}

async function getPaymentCards(): Promise<FinanceCard[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')

  if (error) return []
  return ((data as FinanceCard[]) ?? []).sort((left, right) => {
    if (left.card_type !== right.card_type) return left.card_type === 'banka_karti' ? -1 : 1
    return `${left.bank_name} ${left.card_name}`.localeCompare(`${right.bank_name} ${right.card_name}`, 'tr')
  })
}

function getPaymentScheduleLabel(payment: Payment) {
  if (payment.recurrence !== 'monthly') return 'Tek seferlik'

  const endDate = payment.recurrence_end_date ? ` · ${formatDate(payment.recurrence_end_date)} bitecek` : ''
  return `Aylık · Her ayın ${payment.recurrence_day ?? '-'}. günü${endDate}`
}

function getPaymentMethodLabel(payment: Payment) {
  return payment.payment_method === 'bank_auto' ? 'Banka talimatı' : 'Manuel ödeme'
}

function getAmountStatusLabel(payment: Payment) {
  return payment.amount_status === 'estimated' ? 'Tahmini' : 'Kesin'
}

function getPaymentAmountLabel(payment: Payment) {
  if (payment.amount <= 0 && payment.amount_status === 'estimated') return 'Tutar bekleniyor'
  const prefix = payment.amount_status === 'estimated' ? 'Yaklaşık ' : ''
  return `${prefix}${formatCurrency(payment.amount)}`
}

function isSchemaCacheError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === 'PGRST202' || error.code === 'PGRST204' || message.includes('schema cache') || message.includes('Could not find the function')
}

function PaymentsOverview({ rows }: { rows: Payment[] }) {
  const pending = rows.filter((row) => row.status === 'bekliyor')
  if (rows.length === 0) return null

  const pendingTotal = pending.reduce((sum, row) => sum + row.amount, 0)
  const recurringCount = rows.filter((row) => row.recurrence === 'monthly').length
  const paidCount = rows.filter((row) => row.status === 'ödendi').length
  const paidRate = rows.length > 0 ? Math.min(100, (paidCount / rows.length) * 100) : 0
  const overdueCount = pending.filter((row) => {
    const remaining = daysUntil(row.due_date)
    return remaining !== null && remaining < 0
  }).length
  const nextPayment = [...pending].sort((a, b) => a.due_date.localeCompare(b.due_date))[0]

  return (
    <Card variant="elevated" className="overflow-hidden">
      <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-warning via-primary to-success opacity-80" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="finance-label">Bekleyen Ödemeler</p>
            <p className="finance-value mt-1.5 text-[clamp(1.5rem,6vw,2.1rem)] font-bold leading-none text-foreground">{formatCurrency(pendingTotal)}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {pending.length} bekleyen · {recurringCount} aylık tekrar
            </p>
          </div>
          <Badge variant={overdueCount > 0 ? 'destructive' : 'success'}>
            {overdueCount > 0 ? `${overdueCount} geciken` : `${paidCount}/${rows.length} ödendi`}
          </Badge>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-muted-foreground">Tamamlanma</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">%{Math.round(paidRate)}</span>
          </div>
          <Progress value={paidRate} color="success" size="default" />
        </div>
        {nextPayment ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{nextPayment.title}</p>
              <p className="text-xs text-muted-foreground">Sıradaki tarih {formatDate(nextPayment.due_date)}</p>
            </div>
            <span className="finance-value shrink-0 text-sm font-bold text-foreground">{getPaymentAmountLabel(nextPayment)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function PaymentsPage() {
  const [paymentToPay, setPaymentToPay] = useState<Payment | null>(null)
  const [paymentCards, setPaymentCards] = useState<FinanceCard[]>([])
  const [paymentSourceCard, setPaymentSourceCard] = useState('')
  const [paidAmount, setPaidAmount] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [reloadPayments, setReloadPayments] = useState<(() => Promise<void>) | null>(null)

  async function openPayment(payment: Payment, reload: () => Promise<void>) {
    const cards = await getPaymentCards()
    setPaymentToPay(payment)
    setPaymentCards(cards)
    setPaymentSourceCard(resolvePreferred(getLastUsed('paymentAccount'), cards.map((card) => card.id)))
    setPaidAmount(payment.amount > 0 ? String(payment.amount) : '')
    setPaymentError(cards.length === 0 ? 'Ödeme için önce bir banka hesabı veya kredi kartı eklemelisin.' : '')
    setReloadPayments(() => reload)
  }

  function closePayment() {
    setPaymentToPay(null)
    setPaymentSourceCard('')
    setPaidAmount('')
    setPaymentError('')
  }

  async function handlePaymentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!paymentToPay) return

    const parsedPaidAmount = parseNumber(paidAmount)
    if (parsedPaidAmount <= 0) {
      setPaymentError('Ödenen tutar 0’dan büyük olmalı.')
      return
    }

    if (!paymentSourceCard) {
      setPaymentError('Kaynak hesap seçmelisin.')
      return
    }

    const sourceCard = paymentCards.find((card) => card.id === paymentSourceCard)
    if (!sourceCard) {
      setPaymentError('Kaynak hesap bulunamadı.')
      return
    }

    if (sourceCard.card_type === 'banka_karti' && sourceCard.current_balance < parsedPaidAmount) {
      setPaymentError('Kaynak hesap bakiyesi yetersiz.')
      return
    }

    setPaymentSaving(true)
    setPaymentError('')

    const { error } = await supabase.rpc('pay_payment', {
      p_payment_id: paymentToPay.id,
      p_source_card_id: sourceCard.id,
      p_paid_amount: parsedPaidAmount,
    })

    let submitError = error
    if (submitError && isSchemaCacheError(submitError)) {
      const { error: updateError } = await supabase
        .from('payments')
        .update({ amount: parsedPaidAmount, updated_at: new Date().toISOString() })
        .eq('id', paymentToPay.id)

      if (updateError) {
        submitError = updateError
      } else {
        const { error: legacyError } = await supabase.rpc('pay_payment', {
          p_payment_id: paymentToPay.id,
          p_source_card_id: sourceCard.id,
        })
        submitError = legacyError
      }
    }

    setPaymentSaving(false)
    if (submitError) {
      setPaymentError(submitError.message)
      return
    }

    setLastUsed('paymentAccount', sourceCard.id)
    closePayment()
    await reloadPayments?.()
  }

  return (
    <>
      <CrudPage
        table="payments"
        pageTitle="Planlı ödemeler"
        addLabel="Planlı ödeme ekle"
        fields={fields}
        emptyTitle="Henüz planlı ödeme yok"
        emptyDescription="Yaklaşan kira, fatura veya tek seferlik ödemelerini buradan ekleyebilirsin."
        orderBy="due_date"
        validateForm={validatePaymentForm}
        renderBeforeList={({ loading, rows }) => (!loading ? <PaymentsOverview rows={rows as Payment[]} /> : null)}
        getInitialValues={(row?: Payment) => ({
          title: row?.title ?? '',
          category: row?.category ?? 'Diğer',
          payment_method: row?.payment_method ?? 'manual',
          amount_status: row?.amount_status ?? (row?.category === 'Fatura' ? 'estimated' : 'exact'),
          amount: row?.amount ?? 0,
          due_date: row?.due_date ?? new Date().toISOString().slice(0, 10),
          recurrence: row?.recurrence ?? 'none',
          recurrence_day: row?.recurrence_day ?? (row?.due_date ? new Date(`${row.due_date}T00:00:00`).getDate() : new Date().getDate()),
          recurrence_end_date: row?.recurrence_end_date ?? '',
          status: row?.status ?? 'bekliyor',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId, editing) => {
          const recurrence = formData.get('recurrence') as Payment['recurrence']

          return {
            user_id: userId,
            title: String(formData.get('title') ?? '').trim(),
            category: (formData.get('category') as PaymentCategory | null) ?? 'Diğer',
            payment_method: (formData.get('payment_method') as PaymentMethod | null) ?? 'manual',
            amount_status: (formData.get('amount_status') as PaymentAmountStatus | null) ?? 'exact',
            amount: parseNumber(formData.get('amount')),
            due_date: String(formData.get('due_date') ?? ''),
            status: recurrence === 'monthly' ? 'bekliyor' : (editing?.status ?? 'bekliyor'),
            recurrence,
            recurrence_day: recurrence === 'monthly' ? Number(formData.get('recurrence_day')) : null,
            recurrence_end_date: recurrence === 'monthly' ? String(formData.get('recurrence_end_date') ?? '') || null : null,
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.title}
        renderSubtitle={(row) => `${row.category} · ${row.status} · ${getPaymentScheduleLabel(row)}`}
        renderDetails={(row) => [
          `Tutar: ${getPaymentAmountLabel(row)}`,
          `Durum: ${getAmountStatusLabel(row)} · ${getPaymentMethodLabel(row)}`,
          `Sıradaki tarih: ${formatDate(row.due_date)}`,
        ]}
        groupBy={(row) => row.category}
        renderRowActions={(row, helpers) =>
          row.status === 'bekliyor' ? (
            <button
              type="button"
              onClick={() => void openPayment(row, helpers.reload)}
              className="rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--success)_28%,transparent)] transition hover:bg-success/90 active:scale-[0.97]"
            >
              Öde
            </button>
          ) : null
        }
      />

      <SimpleModal title="Ödeme yap" open={Boolean(paymentToPay)} onClose={closePayment}>
        <form onSubmit={handlePaymentSubmit} className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{paymentToPay?.title}</p>
            <p className="mt-0.5">Planlanan tutar: <span className="font-mono font-semibold text-foreground">{paymentToPay ? getPaymentAmountLabel(paymentToPay) : '-'}</span></p>
            <p className="mt-0.5">Yöntem: {paymentToPay ? getPaymentMethodLabel(paymentToPay) : '-'}</p>
            <p className="mt-0.5">Vade: {paymentToPay ? formatDate(paymentToPay.due_date) : '-'}</p>
          </div>
          <MoneyInput label="Ödenen gerçek tutar" value={paidAmount} onValueChange={setPaidAmount} required />
          <AccountSelector
            accounts={paymentCards}
            value={paymentSourceCard}
            onChange={setPaymentSourceCard}
            amount={parseNumber(paidAmount)}
            label="Ödeme kaynağı"
            emptyMessage="Kullanılabilir banka hesabı veya kredi kartı yok."
          />
          {paymentError ? (
            <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{paymentError}</p>
          ) : null}
          <button
            type="submit"
            disabled={paymentSaving}
            className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
          >
            {paymentSaving ? 'İşleniyor...' : 'Ödemeyi tamamla'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
