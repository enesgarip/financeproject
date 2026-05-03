import { useState } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { SimpleModal } from '../components/SimpleModal'
import { supabase } from '../lib/supabase'
import type { Card, Loan } from '../types/database'
import { formatDate, startOfToday } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

function getNextPaymentDate(installmentDay: number | null, remainingInstallments: number): string | null {
  if (!installmentDay || remainingInstallments <= 0) return null

  const today = startOfToday()
  const currentMonth = today.getMonth()
  const currentYear = today.getFullYear()

  let nextDate = new Date(currentYear, currentMonth, installmentDay)
  if (nextDate < today) {
    nextDate = new Date(currentYear, currentMonth + 1, installmentDay)
  }

  return formatDate(nextDate.toLocaleDateString('sv-SE'))
}

const fields: FormField[] = [
  { name: 'bank_name', label: 'Banka', type: 'text', required: true },
  { name: 'loan_name', label: 'Kredi adı', type: 'text', required: true },
  { name: 'total_amount', label: 'Toplam kredi tutarı', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'remaining_amount', label: 'Kalan borç', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'monthly_payment', label: 'Aylık ödeme', type: 'number', min: '0', step: '0.01', required: true },
  {
    name: 'installment_day',
    label: 'Taksit günü',
    type: 'select',
    options: Array.from({ length: 31 }, (_, index) => ({
      label: `Ayın ${index + 1}. günü`,
      value: String(index + 1),
    })),
  },
  { name: 'start_date', label: 'Başlangıç tarihi', type: 'date' },
  { name: 'end_date', label: 'Bitiş tarihi', type: 'date' },
  { name: 'remaining_installments', label: 'Kalan taksit', type: 'number', min: '0', step: '1', required: true },
  {
    name: 'status',
    label: 'Durum',
    type: 'select',
    options: [
      { label: 'Aktif', value: 'active' },
      { label: 'Kapalı', value: 'closed' },
    ],
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function optionalDate(value: FormDataEntryValue | null) {
  const date = String(value ?? '')
  return date || null
}

async function getBankaKartlari(): Promise<Card[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('card_type', 'banka_karti')

  if (error) return []
  return (data as Card[]) ?? []
}

export function LoansPage() {
  const [installmentLoan, setInstallmentLoan] = useState<Loan | null>(null)
  const [installmentAmount, setInstallmentAmount] = useState('')
  const [installmentSourceCard, setInstallmentSourceCard] = useState('')
  const [installmentError, setInstallmentError] = useState('')
  const [installmentSaving, setInstallmentSaving] = useState(false)
  const [reloadLoans, setReloadLoans] = useState<(() => Promise<void>) | null>(null)
  const [bankaKartlari, setBankaKartlari] = useState<Card[]>([])

  async function openInstallmentPayment(loan: Loan, reload: () => Promise<void>) {
    const cards = await getBankaKartlari()
    setInstallmentLoan(loan)
    setReloadLoans(() => reload)
    setBankaKartlari(cards)
    setInstallmentAmount(String(loan.monthly_payment))
    setInstallmentSourceCard('')
    setInstallmentError('')
  }

  async function handleInstallmentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!installmentLoan) return

    const amount = parseNumber(installmentAmount)
    if (amount <= 0) {
      setInstallmentError('Tutar 0 dan büyük olmalı.')
      return
    }

    if (!installmentSourceCard) {
      setInstallmentError('Kaynak hesap seçmelisin.')
      return
    }

    const sourceCard = bankaKartlari.find((c) => c.id === installmentSourceCard)
    if (!sourceCard) {
      setInstallmentError('Kaynak hesap bulunamadı.')
      return
    }

    if (sourceCard.current_balance < amount) {
      setInstallmentError('Kaynak hesap bakiyesi yetersiz.')
      return
    }

    setInstallmentSaving(true)
    setInstallmentError('')

    const { error: sourceError } = await supabase
      .from('cards')
      .update({ current_balance: sourceCard.current_balance - amount, updated_at: new Date().toISOString() })
      .eq('id', sourceCard.id)

    if (sourceError) {
      setInstallmentSaving(false)
      setInstallmentError(sourceError.message)
      return
    }

    const remainingInstallments = Math.max(0, installmentLoan.remaining_installments - 1)
    const remainingAmount = Math.max(0, installmentLoan.remaining_amount - amount)
    const status = remainingInstallments === 0 || remainingAmount === 0 ? 'closed' : 'active'

    const { error: loanError } = await supabase
      .from('loans')
      .update({
        remaining_installments: remainingInstallments,
        remaining_amount: remainingAmount,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', installmentLoan.id)

    setInstallmentSaving(false)
    if (loanError) {
      setInstallmentError(loanError.message)
      return
    }

    setInstallmentLoan(null)
    await reloadLoans?.()
  }

  return (
    <>
      <CrudPage
        table="loans"
        pageTitle="Krediler"
        addLabel="Kredi ekle"
        fields={fields}
        emptyTitle="Henüz kredi yok"
        emptyDescription="Aktif veya kapanmış kredilerini, taksit günleriyle birlikte ekleyebilirsin."
        getInitialValues={(row?: Loan) => ({
        bank_name: row?.bank_name ?? '',
        loan_name: row?.loan_name ?? '',
        total_amount: row?.total_amount ?? 0,
        remaining_amount: row?.remaining_amount ?? 0,
        monthly_payment: row?.monthly_payment ?? 0,
        installment_day: row?.installment_day ?? '',
        start_date: row?.start_date ?? '',
        end_date: row?.end_date ?? '',
        remaining_installments: row?.remaining_installments ?? 0,
        status: row?.status ?? 'active',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        bank_name: String(formData.get('bank_name') ?? ''),
        loan_name: String(formData.get('loan_name') ?? ''),
        total_amount: parseNumber(formData.get('total_amount')),
        remaining_amount: parseNumber(formData.get('remaining_amount')),
        monthly_payment: parseNumber(formData.get('monthly_payment')),
        installment_day: optionalDay(formData.get('installment_day')),
        start_date: optionalDate(formData.get('start_date')),
        end_date: optionalDate(formData.get('end_date')),
        remaining_installments: Math.trunc(parseNumber(formData.get('remaining_installments'))),
        status: formData.get('status') as Loan['status'],
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.loan_name}
      renderSubtitle={(row) => `${row.bank_name} · ${row.status === 'active' ? 'Aktif kredi' : 'Kapalı kredi'}`}
      renderDetails={(row) => {
        const details = [
          `Kalan borç: ${formatCurrency(row.remaining_amount)}`,
          `Aylık ödeme: ${formatCurrency(row.monthly_payment)}`,
          `Taksit günü: ${row.installment_day ? `Ayın ${row.installment_day}. günü` : '-'}`,
          `Kalan taksit: ${row.remaining_installments}`,
        ]
        if (row.status === 'active' && row.installment_day) {
          const nextPayment = getNextPaymentDate(row.installment_day, row.remaining_installments)
          if (nextPayment) details.push(`Bir sonraki ödeme: ${nextPayment}`)
        }
        if (row.end_date) details.push(`Bitiş tarihi: ${formatDate(row.end_date)}`)
        return details
      }}
      renderRowActions={(row, helpers) =>
        row.status === 'active' && row.remaining_installments > 0 ? (
          <button
            type="button"
            onClick={() => void openInstallmentPayment(row, helpers.reload)}
            className="rounded-lg border border-stone-200 bg-stone-700 px-3 py-2 text-xs font-semibold text-white shadow-sm dark:border-stone-700 dark:bg-stone-600"
          >
            Taksit öde
          </button>
        ) : null
      }
    />

      <SimpleModal title="Taksit ödemesi" open={Boolean(installmentLoan)} onClose={() => setInstallmentLoan(null)}>
        <form onSubmit={handleInstallmentSubmit} className="space-y-4">
          <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            <p className="font-semibold text-stone-950 dark:text-stone-50">{installmentLoan?.loan_name}</p>
            <p>Aylık taksit: {formatCurrency(installmentLoan?.monthly_payment ?? 0)}</p>
            <p>Kalan taksit: {installmentLoan?.remaining_installments ?? 0}</p>
          </div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Ödeme tutarı
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={installmentAmount}
              onChange={(event) => setInstallmentAmount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Kaynak hesap
            <select
              required
              value={installmentSourceCard}
              onChange={(event) => setInstallmentSourceCard(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              <option value="">Hesap seç</option>
              {bankaKartlari.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.card_name} ({formatCurrency(card.current_balance)})
                </option>
              ))}
            </select>
          </label>
          {installmentError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{installmentError}</p> : null}
          <button
            type="submit"
            disabled={installmentSaving}
            className="w-full rounded-xl bg-stone-700 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-stone-600"
          >
            {installmentSaving ? 'İşleniyor...' : 'Taksit öde'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
