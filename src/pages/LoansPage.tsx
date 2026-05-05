import { Check, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { SimpleModal } from '../components/SimpleModal'
import { supabase } from '../lib/supabase'
import type { Card, InsertFor, Loan, LoanInstallment } from '../types/database'
import { formatDate, startOfToday } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { addTransactionHistory } from '../utils/history'

function getNextPaymentDate(installmentDay: number | null, remainingInstallments: number): string | null {
  if (!installmentDay || remainingInstallments <= 0) return null

  const today = startOfToday()
  const currentMonth = today.getMonth()
  const currentYear = today.getFullYear()

  let nextDate = dateInMonth(currentYear, currentMonth, installmentDay)
  if (nextDate < today) {
    nextDate = dateInMonth(currentYear, currentMonth + 1, installmentDay)
  }

  return formatDate(dateInputValue(nextDate))
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
    required: true,
    options: Array.from({ length: 31 }, (_, index) => ({
      label: `Ayın ${index + 1}. günü`,
      value: String(index + 1),
    })),
  },
  { name: 'start_date', label: 'Başlangıç tarihi', type: 'date', required: true },
  { name: 'end_date', label: 'Bitiş tarihi', type: 'date', required: true },
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

function parseLocalDate(value: string | null | undefined) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function dateInputValue(date: Date) {
  return date.toLocaleDateString('sv-SE')
}

function dateInMonth(year: number, month: number, preferredDay: number) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(preferredDay, lastDay))
}

function buildLoanSchedule(loan: Loan): InsertFor<'loan_installments'>[] {
  const start = parseLocalDate(loan.start_date)
  const end = parseLocalDate(loan.end_date)
  if (!start || !end || !loan.installment_day || loan.monthly_payment <= 0 || end < start) return []

  const schedule: InsertFor<'loan_installments'>[] = []
  let cursorMonth = start.getMonth()
  let cursorYear = start.getFullYear()
  let dueDate = dateInMonth(cursorYear, cursorMonth, loan.installment_day)

  if (dueDate < start) {
    cursorMonth += 1
    dueDate = dateInMonth(cursorYear, cursorMonth, loan.installment_day)
  }

  while (dueDate <= end && schedule.length < 240) {
    schedule.push({
      user_id: loan.user_id,
      loan_id: loan.id,
      installment_no: schedule.length + 1,
      due_date: dateInputValue(dueDate),
      amount: loan.monthly_payment,
      status: 'bekliyor',
      paid_at: null,
      note: null,
    })

    const nextMonth = new Date(cursorYear, cursorMonth + 1, 1)
    cursorYear = nextMonth.getFullYear()
    cursorMonth = nextMonth.getMonth()
    dueDate = dateInMonth(cursorYear, cursorMonth, loan.installment_day)
  }

  return schedule
}

function validateLoanForm(formData: FormData) {
  const errors: Record<string, string> = {}
  const totalAmount = parseNumber(formData.get('total_amount'))
  const remainingAmount = parseNumber(formData.get('remaining_amount'))
  const monthlyPayment = parseNumber(formData.get('monthly_payment'))
  const remainingInstallments = parseNumber(formData.get('remaining_installments'))
  const startDate = String(formData.get('start_date') ?? '')
  const endDate = String(formData.get('end_date') ?? '')

  if (totalAmount <= 0) errors.total_amount = 'Toplam kredi tutarı 0’dan büyük olmalı.'
  if (remainingAmount < 0) errors.remaining_amount = 'Kalan borç negatif olamaz.'
  if (monthlyPayment <= 0) errors.monthly_payment = 'Aylık ödeme 0’dan büyük olmalı.'
  if (!Number.isInteger(remainingInstallments) || remainingInstallments < 0) {
    errors.remaining_installments = 'Kalan taksit 0 veya daha büyük tam sayı olmalı.'
  }
  if (startDate && endDate && endDate < startDate) {
    errors.end_date = 'Bitiş tarihi başlangıç tarihinden önce olamaz.'
  }

  return errors
}

async function getBankaKartlari(): Promise<Card[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('card_type', 'banka_karti')

  if (error) return []
  return (data as Card[]) ?? []
}

async function updateLoanTotalsFromInstallments(loanId: string) {
  const { data, error } = await supabase.from('loan_installments').select('*').eq('loan_id', loanId)
  if (error) throw new Error(error.message)

  const installments = ((data ?? []) as LoanInstallment[]).filter((item) => item.status !== 'ödendi')
  const remainingAmount = installments.reduce((total, item) => total + item.amount, 0)
  const remainingInstallments = installments.length
  const { error: updateError } = await supabase
    .from('loans')
    .update({
      remaining_amount: remainingAmount,
      remaining_installments: remainingInstallments,
      status: remainingInstallments === 0 ? 'closed' : 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', loanId)

  if (updateError) throw new Error(updateError.message)
}

async function syncLoanInstallmentPlan(loan: Loan) {
  const schedule = buildLoanSchedule(loan)
  if (schedule.length === 0) return

  const { data: existingData, error: existingError } = await supabase.from('loan_installments').select('*').eq('loan_id', loan.id)
  if (existingError) throw new Error(existingError.message)

  const existing = ((existingData ?? []) as LoanInstallment[])
  const existingByNo = new Map(existing.map((item) => [item.installment_no, item]))
  const desiredNumbers = new Set(schedule.map((item) => item.installment_no))
  const payload = schedule.map((item) => {
    const current = existingByNo.get(item.installment_no)
    return {
      ...item,
      id: current?.id,
      status: current?.status ?? item.status,
      paid_at: current?.paid_at ?? item.paid_at,
      note: current?.note ?? item.note,
    }
  })

  const { error: upsertError } = await supabase
    .from('loan_installments')
    .upsert(payload, { onConflict: 'loan_id,installment_no' })

  if (upsertError) throw new Error(upsertError.message)

  const extraIds = existing.filter((item) => !desiredNumbers.has(item.installment_no)).map((item) => item.id)
  if (extraIds.length > 0) {
    const { error: deleteError } = await supabase.from('loan_installments').delete().in('id', extraIds)
    if (deleteError) throw new Error(deleteError.message)
  }

  await updateLoanTotalsFromInstallments(loan.id)
}

export function LoansPage() {
  const [installmentLoan, setInstallmentLoan] = useState<Loan | null>(null)
  const [installmentAmount, setInstallmentAmount] = useState('')
  const [installmentSourceCard, setInstallmentSourceCard] = useState('')
  const [installmentError, setInstallmentError] = useState('')
  const [installmentSaving, setInstallmentSaving] = useState(false)
  const [reloadLoans, setReloadLoans] = useState<(() => Promise<void>) | null>(null)
  const [bankaKartlari, setBankaKartlari] = useState<Card[]>([])
  const [installments, setInstallments] = useState<LoanInstallment[]>([])
  const [planMenuOpenId, setPlanMenuOpenId] = useState<string | null>(null)
  const [editingPlanItem, setEditingPlanItem] = useState<LoanInstallment | null>(null)
  const [planDueDate, setPlanDueDate] = useState('')
  const [planAmount, setPlanAmount] = useState('')
  const [planNote, setPlanNote] = useState('')
  const [planError, setPlanError] = useState('')
  const [planSaving, setPlanSaving] = useState(false)

  const loadInstallments = useCallback(async () => {
    const { data, error } = await supabase
      .from('loan_installments')
      .select('*')
      .order('due_date', { ascending: true })
      .order('installment_no', { ascending: true })

    if (!error) setInstallments((data ?? []) as LoanInstallment[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInstallments()
  }, [loadInstallments])

  useEffect(() => {
    function handleClickOutside() {
      setPlanMenuOpenId(null)
    }

    if (planMenuOpenId) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [planMenuOpenId])

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

    const nextPlanItem = installments
      .filter((item) => item.loan_id === installmentLoan.id && item.status !== 'ödendi')
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]

    if (nextPlanItem) {
      const paidAt = new Date().toISOString()
      const { error: planError } = await supabase
        .from('loan_installments')
        .update({ status: 'ödendi', paid_at: paidAt, amount, updated_at: paidAt })
        .eq('id', nextPlanItem.id)

      if (planError) {
        setInstallmentSaving(false)
        setInstallmentError(planError.message)
        return
      }

      try {
        await updateLoanTotalsFromInstallments(installmentLoan.id)
      } catch (loanError) {
        setInstallmentSaving(false)
        setInstallmentError(loanError instanceof Error ? loanError.message : 'Kredi güncellenemedi.')
        return
      }
    } else {
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

      if (loanError) {
        setInstallmentSaving(false)
        setInstallmentError(loanError.message)
        return
      }
    }

    const historyError = await addTransactionHistory({
      user_id: installmentLoan.user_id,
      type: 'loan',
      title: `${installmentLoan.loan_name} taksit ödemesi`,
      amount,
      source_table: 'loans',
      source_id: installmentLoan.id,
      note: `${sourceCard.card_name} hesabından ödendi.`,
    })

    setInstallmentSaving(false)
    if (historyError) {
      setInstallmentError(historyError.message)
      return
    }

    setInstallmentLoan(null)
    await loadInstallments()
    await reloadLoans?.()
  }

  async function toggleInstallmentPaid(item: LoanInstallment, loan: Loan, reload: () => Promise<void>, setError: (message: string) => void) {
    const nextStatus = item.status === 'ödendi' ? 'bekliyor' : 'ödendi'
    const paidAt = nextStatus === 'ödendi' ? new Date().toISOString() : null
    const { error } = await supabase
      .from('loan_installments')
      .update({ status: nextStatus, paid_at: paidAt, updated_at: new Date().toISOString() })
      .eq('id', item.id)

    if (error) {
      setError(error.message)
      return
    }

    if (nextStatus === 'ödendi') {
      const historyError = await addTransactionHistory({
        user_id: loan.user_id,
        type: 'loan',
        title: `${loan.loan_name} taksidi ödendi`,
        amount: item.amount,
        source_table: 'loan_installments',
        source_id: item.id,
        note: formatDate(item.due_date),
      })
      if (historyError) setError(historyError.message)
    }

    try {
      await updateLoanTotalsFromInstallments(loan.id)
      await loadInstallments()
      await reload()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Kredi güncellenemedi.')
    }
  }

  function openPlanEdit(item: LoanInstallment) {
    setEditingPlanItem(item)
    setPlanDueDate(item.due_date)
    setPlanAmount(String(item.amount))
    setPlanNote(item.note ?? '')
    setPlanError('')
    setPlanMenuOpenId(null)
  }

  async function handlePlanEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingPlanItem) return

    const amount = parseNumber(planAmount)
    if (!planDueDate) {
      setPlanError('Vade tarihi zorunlu.')
      return
    }
    if (amount <= 0) {
      setPlanError('Taksit tutarı 0’dan büyük olmalı.')
      return
    }

    setPlanSaving(true)
    const { error } = await supabase
      .from('loan_installments')
      .update({
        due_date: planDueDate,
        amount,
        note: planNote || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingPlanItem.id)

    setPlanSaving(false)
    if (error) {
      setPlanError(error.message)
      return
    }

    try {
      await updateLoanTotalsFromInstallments(editingPlanItem.loan_id)
      await loadInstallments()
      await reloadLoans?.()
    } catch {
      // The edited row is already saved; totals will recover on the next explicit loan action.
    }

    setEditingPlanItem(null)
  }

  async function deletePlanItem(item: LoanInstallment, reload: () => Promise<void>, setError: (message: string) => void) {
    const confirmed = window.confirm('Bu taksiti ödeme planından silmek istiyor musun?')
    if (!confirmed) return

    const { error } = await supabase.from('loan_installments').delete().eq('id', item.id)
    if (error) {
      setError(error.message)
      return
    }

    try {
      await updateLoanTotalsFromInstallments(item.loan_id)
      await loadInstallments()
      await reload()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Kredi güncellenemedi.')
    }
  }

  function renderPaymentPlan(loan: Loan, reload: () => Promise<void>, setError: (message: string) => void) {
    const loanInstallments = installments.filter((item) => item.loan_id === loan.id)
    if (loanInstallments.length === 0) return null

    return (
      <section className="mt-4 rounded-2xl border border-stone-200 bg-white/65 p-3 dark:border-stone-800 dark:bg-stone-950/50">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Ödeme planı</h3>
          <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {loanInstallments.filter((item) => item.status === 'ödendi').length}/{loanInstallments.length}
          </span>
        </div>
        <div className="space-y-2">
          {loanInstallments.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-xl bg-stone-50 px-2 py-2 text-sm dark:bg-stone-900"
            >
              <button
                type="button"
                onClick={() => void toggleInstallmentPaid(item, loan, reload, setError)}
                className={`grid size-8 shrink-0 place-items-center rounded-full border ${
                  item.status === 'ödendi'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-stone-300 bg-white text-transparent dark:border-stone-700 dark:bg-stone-950'
                }`}
                aria-label={item.status === 'ödendi' ? 'Taksiti bekliyor yap' : 'Taksiti ödendi işaretle'}
              >
                <Check size={16} strokeWidth={3} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-stone-900 dark:text-stone-100">
                  {item.installment_no}. taksit · {formatCurrency(item.amount)}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {formatDate(item.due_date)} · {item.status === 'ödendi' ? 'Ödendi' : 'Bekliyor'}
                </p>
              </div>
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setPlanMenuOpenId(planMenuOpenId === item.id ? null : item.id)
                  }}
                  className="grid size-8 place-items-center rounded-full text-stone-500 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-800"
                  aria-label="Taksit menüsü"
                >
                  <MoreVertical size={16} />
                </button>
                {planMenuOpenId === item.id ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                    <button
                      type="button"
                      onClick={() => openPlanEdit(item)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
                    >
                      <Pencil size={14} />
                      Düzenle
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlanMenuOpenId(null)
                        void deletePlanItem(item, reload, setError)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 size={14} />
                      Sil
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    )
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
        validateForm={validateLoanForm}
        afterSave={async (row) => {
          await syncLoanInstallmentPlan(row as Loan)
          await loadInstallments()
        }}
        getInitialValues={(row?: Loan) => ({
          bank_name: row?.bank_name ?? '',
          loan_name: row?.loan_name ?? '',
          total_amount: row?.total_amount ?? 0,
          remaining_amount: row?.remaining_amount ?? row?.total_amount ?? 0,
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
          bank_name: String(formData.get('bank_name') ?? '').trim(),
          loan_name: String(formData.get('loan_name') ?? '').trim(),
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
        renderExtra={(row, helpers) => renderPaymentPlan(row as Loan, helpers.reload, helpers.setError)}
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

      <SimpleModal title="Taksiti düzenle" open={Boolean(editingPlanItem)} onClose={() => setEditingPlanItem(null)}>
        <form onSubmit={handlePlanEditSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Vade tarihi
            <input
              required
              type="date"
              value={planDueDate}
              onChange={(event) => setPlanDueDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Tutar
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={planAmount}
              onChange={(event) => setPlanAmount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Not
            <textarea
              rows={3}
              value={planNote}
              onChange={(event) => setPlanNote(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          {planError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{planError}</p> : null}
          <button
            type="submit"
            disabled={planSaving}
            className="w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {planSaving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
