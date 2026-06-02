import { CalendarDays, Check, Landmark, MoreVertical, Pencil, ReceiptText, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { AccountSelector } from '../components/finance/AccountSelector'
import { BankLogo } from '../components/finance/BankLogo'
import { SimpleModal } from '../components/SimpleModal'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { useConfirmDialog } from '../components/ui/use-confirm-dialog'
import { supabase } from '../lib/supabase'
import type { Card, InsertFor, Loan, LoanInstallment } from '../types/database'
import { formatDate, startOfToday } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

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

function nextPendingInstallment(loan: Loan, installments: LoanInstallment[]) {
  return installments
    .filter((item) => item.loan_id === loan.id && item.status !== 'ödendi')
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.installment_no - b.installment_no)[0]
}

function loanProgress(loan: Loan, installments: LoanInstallment[]) {
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

function LoanOverview({ loans, installments }: { loans: Loan[]; installments: LoanInstallment[] }) {
  const activeLoans = loans.filter((loan) => loan.status === 'active')
  if (activeLoans.length === 0) return null

  const totalRemaining = activeLoans.reduce((total, loan) => total + loan.remaining_amount, 0)
  const totalMonthly = activeLoans.reduce((total, loan) => total + loan.monthly_payment, 0)
  const nextItems = activeLoans
    .map((loan) => ({ loan, item: nextPendingInstallment(loan, installments) }))
    .filter((entry): entry is { loan: Loan; item: LoanInstallment } => Boolean(entry.item))
    .sort((a, b) => a.item.due_date.localeCompare(b.item.due_date))
  const nextPayment = nextItems[0]

  return (
    <div className="flex flex-col gap-3">
      <SurfaceCard className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-muted-foreground">Kredi ritmi</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{formatCurrency(totalMonthly)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Aylık ödeme yükü</p>
            </div>
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              <Landmark />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <OverviewStat label="Kalan borç" value={formatCurrency(totalRemaining)} />
            <OverviewStat label="Aktif kredi" value={`${activeLoans.length} kayıt`} />
          </div>
          {nextPayment ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-muted/55 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{nextPayment.loan.loan_name}</p>
                <p className="text-xs text-muted-foreground">Sıradaki taksit · {formatDate(nextPayment.item.due_date)}</p>
              </div>
              <Badge variant="secondary">{formatCurrency(nextPayment.item.amount)}</Badge>
            </div>
          ) : null}
        </CardContent>
      </SurfaceCard>

      <div className="grid gap-3 min-[680px]:grid-cols-2 xl:grid-cols-3">
        {activeLoans.map((loan) => {
          const progress = loanProgress(loan, installments)
          return (
            <SurfaceCard key={loan.id} className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
              <CardHeader className="pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <BankLogo bankName={loan.bank_name} size="sm" />
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{loan.loan_name}</CardTitle>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{loan.bank_name}</p>
                    </div>
                  </div>
                  <Badge variant={progress.next ? 'secondary' : 'default'}>
                    {progress.totalCount ? `${progress.paidCount}/${progress.totalCount}` : `${loan.remaining_installments} kaldı`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-1">
                <Progress value={progress.progressRate} className="h-1.5" />
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <OverviewStat label="Kalan borç" value={formatCurrency(loan.remaining_amount)} />
                  <OverviewStat label="Taksit" value={formatCurrency(loan.monthly_payment)} />
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays size={14} />
                  {progress.next ? formatDate(progress.next.due_date) : 'Bekleyen taksit yok'}
                </div>
              </CardContent>
            </SurfaceCard>
          )
        })}
      </div>
    </div>
  )
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2">
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function validateLoanForm(formData: FormData) {
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
  const { confirm, confirmDialog } = useConfirmDialog()
  const [installmentLoan, setInstallmentLoan] = useState<Loan | null>(null)
  const [installmentItem, setInstallmentItem] = useState<LoanInstallment | null>(null)
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

  async function openInstallmentPayment(loan: Loan, item: LoanInstallment, reload: () => Promise<void>) {
    const cards = await getBankaKartlari()
    setInstallmentLoan(loan)
    setInstallmentItem(item)
    setReloadLoans(() => reload)
    setBankaKartlari(cards)
    setInstallmentSourceCard('')
    setInstallmentError(cards.length === 0 ? 'Ödeme için önce bir banka kartı hesabı eklemelisin.' : '')
  }

  function closeInstallmentPayment() {
    setInstallmentLoan(null)
    setInstallmentItem(null)
    setInstallmentError('')
  }

  async function handleInstallmentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!installmentLoan || !installmentItem) return

    if (installmentItem.amount <= 0) {
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

    if (sourceCard.current_balance < installmentItem.amount) {
      setInstallmentError('Kaynak hesap bakiyesi yetersiz.')
      return
    }

    setInstallmentSaving(true)
    setInstallmentError('')

    const { error } = await supabase.rpc('pay_loan_installment', {
      p_installment_id: installmentItem.id,
      p_source_card_id: sourceCard.id,
    })

    setInstallmentSaving(false)
    if (error) {
      setInstallmentError(error.message)
      return
    }

    closeInstallmentPayment()
    await loadInstallments()
    await reloadLoans?.()
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
    const confirmed = await confirm({
      title: 'Taksiti sil',
      description: 'Bu taksit ödeme planından silinecek ve kredi toplamları yeniden hesaplanacak.',
      confirmLabel: 'Sil',
      variant: 'destructive',
    })
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
    const undoPaidActionId: string | null = null
    if (loanInstallments.length === 0) {
      return (
        <section className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/55 p-3 dark:border-stone-700 dark:bg-stone-950/45">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Ödeme planı yok</h3>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Kredi bilgilerinden aylık taksit listesini oluşturabilirsin.</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await syncLoanInstallmentPlan(loan)
                  await loadInstallments()
                  await reload()
                } catch (syncError) {
                  setError(syncError instanceof Error ? syncError.message : 'Ödeme planı oluşturulamadı.')
                }
              }}
              className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white shadow-sm"
            >
              Plan oluştur
            </button>
          </div>
        </section>
      )
    }

    return (
      <section className="mt-4 rounded-2xl border border-stone-200 bg-white/65 p-3 dark:border-stone-800 dark:bg-stone-950/50">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Ödeme planı</h3>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {loanInstallments.filter((item) => item.status === 'ödendi').length}/{loanInstallments.length}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          {loanInstallments.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-xl bg-stone-50 px-2 py-2 text-sm dark:bg-stone-900"
            >
              {item.status === 'ödendi' ? (
                <div
                  className="grid size-8 shrink-0 place-items-center rounded-full border border-emerald-600 bg-emerald-600 text-white"
                  aria-label="Taksit ödendi"
                >
                  <Check size={16} strokeWidth={3} />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void openInstallmentPayment(loan, item, reload)}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                >
                  <ReceiptText size={13} />
                  Öde
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-stone-900 dark:text-stone-100">
                  {item.installment_no}. taksit · {formatCurrency(item.amount)}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {formatDate(item.due_date)} · {item.status === 'ödendi' ? (undoPaidActionId === item.id ? 'Geri alınıyor...' : 'Ödendi') : 'Bekliyor'}
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
        renderBeforeList={({ loading, rows }) => (!loading ? <LoanOverview loans={rows as Loan[]} installments={installments} /> : null)}
        afterSave={async (row) => {
          await syncLoanInstallmentPlan(row as Loan)
          await loadInstallments()
        }}
        getInitialValues={(row?: Loan) => ({
          bank_name: row?.bank_name ?? '',
          loan_name: row?.loan_name ?? '',
          total_amount: row?.total_amount ?? 0,
          monthly_payment: row?.monthly_payment ?? 0,
          installment_day: row?.installment_day ?? '',
          start_date: row?.start_date ?? '',
          end_date: row?.end_date ?? '',
          status: row?.status ?? 'active',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId) => ({
          user_id: userId,
          bank_name: String(formData.get('bank_name') ?? '').trim(),
          loan_name: String(formData.get('loan_name') ?? '').trim(),
          total_amount: parseNumber(formData.get('total_amount')),
          remaining_amount: parseNumber(formData.get('total_amount')),
          monthly_payment: parseNumber(formData.get('monthly_payment')),
          installment_day: optionalDay(formData.get('installment_day')),
          start_date: optionalDate(formData.get('start_date')),
          end_date: optionalDate(formData.get('end_date')),
          remaining_installments: 0,
          status: formData.get('status') as Loan['status'],
          note: String(formData.get('note') ?? '') || null,
        })}
        renderTitle={(row) => row.loan_name}
        renderSubtitle={(row) => `${row.bank_name} · ${row.status === 'active' ? 'Aktif kredi' : 'Kapalı kredi'}`}
        renderDetails={(row) => {
          const nextInstallment = nextPendingInstallment(row as Loan, installments)
          const details = [
            `Kalan borç: ${formatCurrency(row.remaining_amount)}`,
            `Aylık ödeme: ${formatCurrency(row.monthly_payment)}`,
            `Taksit günü: ${row.installment_day ? `Ayın ${row.installment_day}. günü` : '-'}`,
            `Kalan taksit: ${row.remaining_installments}`,
          ]
          if (row.status === 'active') {
            const nextPayment = nextInstallment
              ? formatDate(nextInstallment.due_date)
              : row.installment_day
                ? getNextPaymentDate(row.installment_day, row.remaining_installments)
                : null
            if (nextPayment) details.push(`Bir sonraki ödeme: ${nextPayment}`)
          }
          if (row.end_date) details.push(`Bitiş tarihi: ${formatDate(row.end_date)}`)
          return details
        }}
        renderExtra={(row, helpers) => renderPaymentPlan(row as Loan, helpers.reload, helpers.setError)}
      />

      <SimpleModal title="Taksit ödemesi" open={Boolean(installmentLoan && installmentItem)} onClose={closeInstallmentPayment}>
        <form onSubmit={handleInstallmentSubmit} className="space-y-4">
          <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            <p className="font-semibold text-stone-950 dark:text-stone-50">{installmentLoan?.loan_name}</p>
            <p>
              {installmentItem?.installment_no}. taksit · {installmentItem ? formatDate(installmentItem.due_date) : '-'}
            </p>
            <p>Planlanan tutar: {formatCurrency(installmentItem?.amount ?? 0)}</p>
            <p>Kalan taksit: {installmentLoan?.remaining_installments ?? 0}</p>
          </div>
          <AccountSelector
            accounts={bankaKartlari}
            value={installmentSourceCard}
            onChange={setInstallmentSourceCard}
            amount={installmentItem?.amount ?? 0}
          />
          {installmentError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{installmentError}</p> : null}
          <button
            type="submit"
            disabled={installmentSaving}
            className="w-full rounded-xl bg-stone-700 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-stone-600"
          >
            {installmentSaving ? 'İşleniyor...' : 'Taksiti öde'}
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
      {confirmDialog}
    </>
  )
}
