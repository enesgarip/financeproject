import type { FormField } from '../components/CrudPage'
import { fetchCardsByType } from '../data/repositories/cardsRepo'
import {
  deleteLoanInstallmentsByIds,
  fetchLoanInstallmentsByLoan,
  upsertLoanInstallments,
} from '../data/repositories/loansRepo'
import type { Card, InsertFor, Loan, LoanInstallment } from '../types/database'
import { dateInMonth, dateInputValue, formatDate, startOfToday } from '../utils/date'
import { parseNumber } from '../utils/formatCurrency'

export function getNextPaymentDate(installmentDay: number | null, remainingInstallments: number): string | null {
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

export const loanFields: FormField[] = [
  { name: 'bank_name', label: 'Banka', type: 'text', required: true },
  { name: 'loan_name', label: 'Kredi adı', type: 'text', required: true },
  { name: 'total_amount', label: 'Toplam kredi tutarı', type: 'number', min: '0', step: '0.01', required: true },
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

export function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function optionalDate(value: FormDataEntryValue | null) {
  const date = String(value ?? '')
  return date || null
}

function parseLocalDate(value: string | null | undefined) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
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
      id: crypto.randomUUID(),
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

export function nextPendingInstallment(loan: Loan, installments: LoanInstallment[]) {
  return installments
    .filter((item) => item.loan_id === loan.id && item.status !== 'ödendi')
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.installment_no - b.installment_no)[0]
}

export function loanProgress(loan: Loan, installments: LoanInstallment[]) {
  const loanInstallments = installments.filter((item) => item.loan_id === loan.id)
  const paidCount = loanInstallments.filter((item) => item.status === 'ödendi').length
  const totalCount = loanInstallments.length || paidCount + loan.remaining_installments
  const progressRate = totalCount > 0 ? Math.min(100, (paidCount / totalCount) * 100) : 0

  return {
    paidCount,
    totalCount,
    progressRate,
    next: nextPendingInstallment(loan, installments),
  }
}

export function validateLoanForm(formData: FormData) {
  const errors: Record<string, string> = {}
  const totalAmount = parseNumber(formData.get('total_amount'))
  const monthlyPayment = parseNumber(formData.get('monthly_payment'))
  const startDate = String(formData.get('start_date') ?? '')
  const endDate = String(formData.get('end_date') ?? '')

  if (totalAmount <= 0) errors.total_amount = 'Toplam kredi tutarı 0’dan büyük olmalı.'
  if (monthlyPayment <= 0) errors.monthly_payment = 'Aylık ödeme 0’dan büyük olmalı.'
  if (startDate && endDate && endDate < startDate) {
    errors.end_date = 'Bitiş tarihi başlangıç tarihinden önce olamaz.'
  }

  return errors
}

export async function getBankaKartlari(): Promise<Card[]> {
  const result = await fetchCardsByType('banka_karti')
  return result.ok ? result.data : []
}

export async function syncLoanInstallmentPlan(loan: Loan) {
  const schedule = buildLoanSchedule(loan)
  if (schedule.length === 0) return

  const existingResult = await fetchLoanInstallmentsByLoan(loan.id)
  if (!existingResult.ok) throw new Error(existingResult.error.message)

  const existing = existingResult.data
  const existingByNo = new Map(existing.map((item) => [item.installment_no, item]))
  const desiredNumbers = new Set(schedule.map((item) => item.installment_no))
  const payload = schedule.map((item) => {
    const current = existingByNo.get(item.installment_no)
    const result: InsertFor<'loan_installments'> = {
      id: current?.id ?? item.id ?? crypto.randomUUID(),
      user_id: item.user_id,
      loan_id: item.loan_id,
      installment_no: item.installment_no,
      due_date: item.due_date,
      amount: item.amount,
      status: current?.status ?? item.status,
      paid_at: current?.paid_at ?? item.paid_at,
      note: current?.note ?? item.note,
    }
    return result
  })

  const upsertResult = await upsertLoanInstallments(payload)
  if (!upsertResult.ok) throw new Error(upsertResult.error.message)

  const extraIds = existing.filter((item) => !desiredNumbers.has(item.installment_no)).map((item) => item.id)
  const deleteExtraResult = await deleteLoanInstallmentsByIds(extraIds)
  if (!deleteExtraResult.ok) throw new Error(deleteExtraResult.error.message)
}
