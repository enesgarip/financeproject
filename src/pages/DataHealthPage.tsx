import { Activity, AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { supabase } from '../lib/supabase'
import type { Card, CardExpense, CardInstallment, InsertFor, Loan, LoanInstallment, Payment } from '../types/database'
import { dateInputValue, formatDate } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'

type HealthData = {
  cards: Card[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  payments: Payment[]
}

type HealthIssue = {
  id: string
  area: 'Kartlar' | 'Krediler' | 'Ödemeler'
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  details: string[]
  fixable: boolean
  fixLabel?: string
  kind:
    | 'cardDebtSplit'
    | 'cardMissingInstallments'
    | 'loanTotals'
    | 'loanPaidAtMissing'
    | 'loanPendingPaidAt'
    | 'paymentDueDay'
    | 'manual'
  payload?: {
    cardId?: string
    loanId?: string
    paymentId?: string
    ids?: string[]
    statementDebt?: number
    currentPeriod?: number
    remainingAmount?: number
    remainingInstallments?: number
    loanStatus?: Loan['status']
    dueDate?: string
    userId?: string
    expenseId?: string
    cardExpenseId?: string
    installmentNos?: number[]
    installmentCount?: number
    baseMonth?: string
    amount?: number
    totalAmount?: number
    description?: string
    category?: string
  }
}

const emptyData: HealthData = {
  cards: [],
  cardExpenses: [],
  cardInstallments: [],
  loans: [],
  loanInstallments: [],
  payments: [],
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function moneyDiffers(left: number, right: number) {
  return Math.abs(roundMoney(left) - roundMoney(right)) > 0.01
}

function currentMonthStart() {
  const today = new Date()
  return dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1))
}

function monthStart(value: string | null | undefined) {
  if (!value) return currentMonthStart()
  return `${value.slice(0, 7)}-01`
}

function addMonthsToMonthStart(value: string, months: number) {
  const [year, month] = monthStart(value).slice(0, 7).split('-').map(Number)
  if (!year || !month) return currentMonthStart()
  return dateInputValue(new Date(year, month - 1 + months, 1))
}

function dateInMonthValue(sourceDate: string, preferredDay: number) {
  const [year, month] = sourceDate.split('-').map(Number)
  if (!year || !month || !preferredDay) return sourceDate
  const lastDay = new Date(year, month, 0).getDate()
  return dateInputValue(new Date(year, month - 1, Math.min(preferredDay, lastDay)))
}

function range(from: number, to: number) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index)
}

function cardLabel(card: Card | undefined) {
  if (!card) return 'Kart bulunamadı'
  return `${card.bank_name} · ${card.card_name}`
}

function parseLegacyPaidCount(expense: CardExpense) {
  const match = expense.note?.match(/(\d+)\/(\d+)\s+taksiti uygulama öncesinde/)
  if (!match) return 0

  const paid = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(paid) || total !== expense.installment_count) return 0

  return Math.max(0, Math.min(expense.installment_count - 1, paid))
}

function inferInstallmentBaseMonth(expense: CardExpense, rows: CardInstallment[]) {
  if (rows.length === 0) return monthStart(expense.spent_at)

  const earliest = [...rows].sort((a, b) => a.installment_no - b.installment_no)[0]
  return addMonthsToMonthStart(earliest.due_month, 1 - earliest.installment_no)
}

function severityClass(severity: HealthIssue['severity']) {
  if (severity === 'error') return 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
  if (severity === 'warning') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
  return 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300'
}

function buildIssues(data: HealthData): HealthIssue[] {
  const issues: HealthIssue[] = []
  const monthStartNow = currentMonthStart()
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const installmentsByExpense = new Map<string, CardInstallment[]>()
  const installmentsByLoan = new Map<string, LoanInstallment[]>()

  for (const item of data.cardInstallments) {
    if (!item.card_expense_id) continue
    installmentsByExpense.set(item.card_expense_id, [...(installmentsByExpense.get(item.card_expense_id) ?? []), item])
  }

  for (const item of data.loanInstallments) {
    installmentsByLoan.set(item.loan_id, [...(installmentsByLoan.get(item.loan_id) ?? []), item])
  }

  for (const card of data.cards.filter((item) => item.card_type === 'kredi_karti')) {
    const statementDebt = Math.min(card.statement_debt_amount, card.debt_amount)
    const currentPeriod = Math.min(card.current_period_spending, Math.max(0, card.debt_amount - statementDebt))

    if (moneyDiffers(statementDebt, card.statement_debt_amount) || moneyDiffers(currentPeriod, card.current_period_spending)) {
      issues.push({
        id: `card-split-${card.id}`,
        area: 'Kartlar',
        severity: 'error',
        title: `${cardLabel(card)} borç kırılımı tutarsız`,
        description: 'Dönem borcu ve dönem içi harcama toplamı güncel toplam borcu aşıyor.',
        details: [
          `Güncel borç: ${formatCurrency(card.debt_amount)}`,
          `Dönem borcu: ${formatCurrency(card.statement_debt_amount)} → ${formatCurrency(statementDebt)}`,
          `Dönem içi: ${formatCurrency(card.current_period_spending)} → ${formatCurrency(currentPeriod)}`,
        ],
        fixable: true,
        fixLabel: 'Borç kırılımını düzelt',
        kind: 'cardDebtSplit',
        payload: { cardId: card.id, statementDebt, currentPeriod },
      })
    }
  }

  const scheduledByCard = new Map<string, CardInstallment[]>()
  for (const item of data.cardInstallments.filter((row) => row.status === 'scheduled' && row.due_month <= monthStartNow)) {
    scheduledByCard.set(item.card_id, [...(scheduledByCard.get(item.card_id) ?? []), item])
  }

  for (const [cardId, rows] of scheduledByCard) {
    const card = cardsById.get(cardId)
    const total = rows.reduce((sum, item) => sum + item.amount, 0)
    const pastCount = rows.filter((item) => item.due_month < monthStartNow).length

    issues.push({
      id: `card-scheduled-${cardId}`,
      area: 'Kartlar',
      severity: pastCount > 0 ? 'warning' : 'info',
      title: `${cardLabel(card)} dönem içine alınmamış taksit`,
      description: 'Bu taksitler hâlâ planlı görünüyor; dönem/ekstre durumunu elle kontrol etmek daha güvenli.',
      details: [`Taksit sayısı: ${rows.length}`, `Toplam: ${formatCurrency(total)}`, pastCount > 0 ? `${pastCount} tanesi geçmiş ayda.` : 'Bu ay içinde.'],
      fixable: false,
      kind: 'manual',
    })
  }

  for (const expense of data.cardExpenses.filter((item) => item.installment_count > 1)) {
    const rows = installmentsByExpense.get(expense.id) ?? []
    const existingNos = new Set(rows.map((row) => row.installment_no))
    const paidBefore = parseLegacyPaidCount(expense)
    const expectedNos = range(paidBefore + 1, expense.installment_count)
    const missingNos = expectedNos.filter((installmentNo) => !existingNos.has(installmentNo))
    const extraRows = rows.filter((row) => row.installment_no <= paidBefore || row.installment_no > expense.installment_count)
    const baseMonth = inferInstallmentBaseMonth(expense, rows)
    const futureMissingNos = missingNos.filter((installmentNo) => addMonthsToMonthStart(baseMonth, installmentNo - 1) > monthStartNow)
    const card = cardsById.get(expense.card_id)

    if (missingNos.length > 0) {
      issues.push({
        id: `card-expense-missing-${expense.id}`,
        area: 'Kartlar',
        severity: futureMissingNos.length > 0 ? 'error' : 'warning',
        title: `${expense.description} eksik taksit satırı`,
        description: 'Taksitli kart harcamasının beklenen plan satırlarının bir kısmı yok.',
        details: [
          `Kart: ${cardLabel(card)}`,
          `Eksik: ${missingNos.map((item) => `${item}/${expense.installment_count}`).join(', ')}`,
          paidBefore > 0 ? `${paidBefore} taksit uygulama öncesi ödenmiş işaretli.` : `Başlangıç: ${formatDate(expense.spent_at)}`,
        ],
        fixable: futureMissingNos.length > 0,
        fixLabel: futureMissingNos.length > 0 ? 'Eksik gelecek taksitleri ekle' : undefined,
        kind: futureMissingNos.length > 0 ? 'cardMissingInstallments' : 'manual',
        payload:
          futureMissingNos.length > 0
            ? {
                userId: expense.user_id,
                cardId: expense.card_id,
                cardExpenseId: expense.id,
                installmentNos: futureMissingNos,
                installmentCount: expense.installment_count,
                baseMonth,
                amount: roundMoney(expense.installment_amount || expense.amount / expense.installment_count),
                totalAmount: expense.amount,
                description: expense.description,
                category: expense.category,
              }
            : undefined,
      })
    }

    if (extraRows.length > 0) {
      issues.push({
        id: `card-expense-extra-${expense.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${expense.description} fazla taksit satırı`,
        description: 'Taksit numarası beklenen aralığın dışında. Silme işlemini otomatik yapmak riskli olduğu için sadece işaretliyorum.',
        details: [`Kart: ${cardLabel(card)}`, `Fazla satırlar: ${extraRows.map((item) => `${item.installment_no}/${item.installment_count}`).join(', ')}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  for (const loan of data.loans) {
    const rows = installmentsByLoan.get(loan.id) ?? []
    const pending = rows.filter((item) => item.status !== 'ödendi')
    const remainingAmount = roundMoney(pending.reduce((total, item) => total + item.amount, 0))
    const remainingInstallments = pending.length
    const loanStatus: Loan['status'] = remainingInstallments === 0 ? 'closed' : 'active'

    if (rows.length > 0 && (moneyDiffers(loan.remaining_amount, remainingAmount) || loan.remaining_installments !== remainingInstallments || loan.status !== loanStatus)) {
      issues.push({
        id: `loan-totals-${loan.id}`,
        area: 'Krediler',
        severity: 'error',
        title: `${loan.loan_name} kalan bilgisi tutarsız`,
        description: 'Kredi kartındaki ödeme planı ile kredi özetindeki kalan tutar/taksit aynı değil.',
        details: [
          `Kalan borç: ${formatCurrency(loan.remaining_amount)} → ${formatCurrency(remainingAmount)}`,
          `Kalan taksit: ${loan.remaining_installments} → ${remainingInstallments}`,
          `Durum: ${loan.status} → ${loanStatus}`,
        ],
        fixable: true,
        fixLabel: 'Kredi özetini düzelt',
        kind: 'loanTotals',
        payload: { loanId: loan.id, remainingAmount, remainingInstallments, loanStatus },
      })
    }

    if (rows.length === 0 && loan.status === 'active' && loan.remaining_installments > 0) {
      issues.push({
        id: `loan-no-plan-${loan.id}`,
        area: 'Krediler',
        severity: 'info',
        title: `${loan.loan_name} ödeme planı yok`,
        description: 'Kredi aktif görünüyor ama taksit planı oluşturulmamış.',
        details: ['Krediler sayfasından plan oluşturulabilir.', `Kalan taksit: ${loan.remaining_installments}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  const paidWithoutDate = data.loanInstallments.filter((item) => item.status === 'ödendi' && !item.paid_at)
  if (paidWithoutDate.length > 0) {
    issues.push({
      id: 'loan-paid-at-missing',
      area: 'Krediler',
      severity: 'warning',
      title: 'Ödenmiş kredi taksitinde ödeme tarihi eksik',
      description: 'Ödenmiş görünen taksitlerde paid_at alanı boş kalmış.',
      details: [`Satır sayısı: ${paidWithoutDate.length}`],
      fixable: true,
      fixLabel: 'Ödeme tarihlerini tamamla',
      kind: 'loanPaidAtMissing',
      payload: { ids: paidWithoutDate.map((item) => item.id) },
    })
  }

  const pendingWithDate = data.loanInstallments.filter((item) => item.status !== 'ödendi' && item.paid_at)
  if (pendingWithDate.length > 0) {
    issues.push({
      id: 'loan-pending-paid-at',
      area: 'Krediler',
      severity: 'warning',
      title: 'Bekleyen kredi taksitinde ödeme tarihi var',
      description: 'Bekleyen taksitlerde paid_at dolu kalmış.',
      details: [`Satır sayısı: ${pendingWithDate.length}`],
      fixable: true,
      fixLabel: 'Bekleyenlerden ödeme tarihini kaldır',
      kind: 'loanPendingPaidAt',
      payload: { ids: pendingWithDate.map((item) => item.id) },
    })
  }

  for (const payment of data.payments.filter((item) => item.recurrence === 'monthly')) {
    if (!payment.recurrence_day) {
      issues.push({
        id: `payment-no-day-${payment.id}`,
        area: 'Ödemeler',
        severity: 'warning',
        title: `${payment.title} tekrar günü eksik`,
        description: 'Aylık ödeme kaydında ay günü boş.',
        details: [`Sıradaki tarih: ${formatDate(payment.due_date)}`],
        fixable: false,
        kind: 'manual',
      })
      continue
    }

    const expectedDueDate = dateInMonthValue(payment.due_date, payment.recurrence_day)
    if (payment.due_date !== expectedDueDate) {
      issues.push({
        id: `payment-due-day-${payment.id}`,
        area: 'Ödemeler',
        severity: 'warning',
        title: `${payment.title} tarihi tekrar günüyle uyuşmuyor`,
        description: 'Aylık ödeme tarihi, seçili tekrar gününe göre hizalanmamış.',
        details: [`Tarih: ${formatDate(payment.due_date)} → ${formatDate(expectedDueDate)}`, `Tekrar günü: ${payment.recurrence_day}`],
        fixable: true,
        fixLabel: 'Ödeme tarihini hizala',
        kind: 'paymentDueDay',
        payload: { paymentId: payment.id, dueDate: expectedDueDate },
      })
    }

    if (payment.status === 'bekliyor' && payment.recurrence_end_date && payment.due_date > payment.recurrence_end_date) {
      issues.push({
        id: `payment-ended-${payment.id}`,
        area: 'Ödemeler',
        severity: 'info',
        title: `${payment.title} bitiş tarihini geçmiş`,
        description: 'Aylık ödeme hâlâ bekliyor ama tekrar bitiş tarihi geride kalmış.',
        details: [`Sıradaki tarih: ${formatDate(payment.due_date)}`, `Bitiş: ${formatDate(payment.recurrence_end_date)}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  return issues.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[a.severity] - severityOrder[b.severity] || a.area.localeCompare(b.area, 'tr-TR')
  })
}

export function DataHealthPage() {
  const [data, setData] = useState<HealthData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    setMessage('')

    const [cards, cardExpenses, cardInstallments, loans, loanInstallments, payments] = await Promise.all([
      supabase.from('cards').select('*'),
      supabase.from('card_expenses').select('*'),
      supabase.from('card_installments').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('loan_installments').select('*'),
      supabase.from('payments').select('*'),
    ])

    const firstError = [cards.error, cardExpenses.error, cardInstallments.error, loans.error, loanInstallments.error, payments.error].find(Boolean)
    if (firstError) {
      setError(firstError.message)
    } else {
      setData({
        cards: (cards.data ?? []) as Card[],
        cardExpenses: (cardExpenses.data ?? []) as CardExpense[],
        cardInstallments: (cardInstallments.data ?? []) as CardInstallment[],
        loans: (loans.data ?? []) as Loan[],
        loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
        payments: (payments.data ?? []) as Payment[],
      })
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  const issues = useMemo(() => buildIssues(data), [data])
  const fixableIssues = issues.filter((issue) => issue.fixable)
  const stats = {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  }

  async function fixIssue(issue: HealthIssue) {
    const payload = issue.payload
    if (!payload) return

    if (issue.kind === 'cardDebtSplit' && payload.cardId) {
      const { error: updateError } = await supabase
        .from('cards')
        .update({
          statement_debt_amount: payload.statementDebt ?? 0,
          current_period_spending: payload.currentPeriod ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.cardId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardMissingInstallments' && payload.userId && payload.cardId && payload.cardExpenseId && payload.installmentNos && payload.baseMonth) {
      const rows: InsertFor<'card_installments'>[] = payload.installmentNos.map((installmentNo) => {
        const dueMonth = addMonthsToMonthStart(payload.baseMonth ?? currentMonthStart(), installmentNo - 1)
        const baseAmount = payload.amount ?? 0
        const installmentCount = payload.installmentCount ?? 1
        const amount =
          payload.totalAmount && installmentNo === installmentCount
            ? roundMoney(payload.totalAmount - baseAmount * (installmentCount - 1))
            : baseAmount

        return {
          user_id: payload.userId ?? '',
          card_id: payload.cardId ?? '',
          card_expense_id: payload.cardExpenseId ?? null,
          installment_no: installmentNo,
          installment_count: installmentCount,
          due_month: dueMonth,
          amount,
          description: payload.description ?? 'Taksit',
          category: payload.category ?? 'Diğer',
          status: 'scheduled',
          posted_at: null,
          note: 'Veri sağlığı kontrolüyle tamamlandı.',
        }
      })

      const { error: insertError } = await supabase.from('card_installments').insert(rows)
      if (insertError) throw new Error(insertError.message)
    }

    if (issue.kind === 'loanTotals' && payload.loanId) {
      const { error: updateError } = await supabase
        .from('loans')
        .update({
          remaining_amount: payload.remainingAmount ?? 0,
          remaining_installments: payload.remainingInstallments ?? 0,
          status: payload.loanStatus ?? 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.loanId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanPaidAtMissing' && payload.ids?.length) {
      const { error: updateError } = await supabase
        .from('loan_installments')
        .update({ paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanPendingPaidAt' && payload.ids?.length) {
      const { error: updateError } = await supabase
        .from('loan_installments')
        .update({ paid_at: null, updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'paymentDueDay' && payload.paymentId && payload.dueDate) {
      const { error: updateError } = await supabase
        .from('payments')
        .update({ due_date: payload.dueDate, updated_at: new Date().toISOString() })
        .eq('id', payload.paymentId)
      if (updateError) throw new Error(updateError.message)
    }
  }

  async function handleFix(issue: HealthIssue) {
    setFixingId(issue.id)
    setError('')
    setMessage('')

    try {
      await fixIssue(issue)
      await loadData()
      setMessage('Düzeltme uygulandı.')
    } catch (fixError) {
      setError(fixError instanceof Error ? fixError.message : 'Düzeltme uygulanamadı.')
    } finally {
      setFixingId(null)
    }
  }

  async function handleFixAll() {
    setFixingId('all')
    setError('')
    setMessage('')

    try {
      for (const issue of fixableIssues) {
        await fixIssue(issue)
      }
      await loadData()
      setMessage(`${fixableIssues.length} güvenli düzeltme uygulandı.`)
    } catch (fixError) {
      setError(fixError instanceof Error ? fixError.message : 'Toplu düzeltme tamamlanamadı.')
      await loadData()
    } finally {
      setFixingId(null)
    }
  }

  return (
    <section className="space-y-4">
      <SurfaceCard className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck size={20} />
                Veri sağlığı
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Kart, kredi ve ödeme kayıtlarındaki tutarsızlıklar.</p>
            </div>
            <Badge variant={issues.length > 0 ? 'secondary' : 'default'}>{loading ? 'Kontrol' : `${issues.length} bulgu`}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <HealthStat label="Kritik" value={stats.errors} />
            <HealthStat label="Uyarı" value={stats.warnings} />
            <HealthStat label="Bilgi" value={stats.info} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading || Boolean(fixingId)}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm disabled:opacity-60 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200"
            >
              <RefreshCw size={15} />
              Yenile
            </button>
            <button
              type="button"
              onClick={() => void handleFixAll()}
              disabled={loading || Boolean(fixingId) || fixableIssues.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60 hover:bg-emerald-800"
            >
              <Wrench size={15} />
              Güvenli düzeltmeleri uygula
            </button>
          </div>
          {message ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p> : null}
          {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p> : null}
        </CardContent>
      </SurfaceCard>

      {loading ? (
        <div className="h-32 animate-pulse rounded-2xl border border-border bg-muted/60" />
      ) : issues.length === 0 ? (
        <SurfaceCard className="border-0 shadow-sm ring-1 ring-emerald-200/80 dark:ring-emerald-900/70">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <h2 className="font-bold text-foreground">Kayıtlar temiz görünüyor</h2>
              <p className="mt-1 text-sm text-muted-foreground">Otomatik kontrolün yakaladığı bir tutarsızlık yok.</p>
            </div>
          </CardContent>
        </SurfaceCard>
      ) : (
        <div className="grid gap-3">
          {issues.map((issue) => (
            <SurfaceCard key={issue.id} className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${severityClass(issue.severity)}`}>
                    {issue.fixable ? <Wrench size={19} /> : issue.severity === 'info' ? <Activity size={19} /> : <AlertTriangle size={19} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{issue.area}</Badge>
                      <Badge variant={issue.fixable ? 'secondary' : 'outline'}>{issue.fixable ? 'Düzeltilebilir' : 'Kontrol gerekli'}</Badge>
                    </div>
                    <h2 className="mt-2 text-base font-bold text-foreground">{issue.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{issue.description}</p>
                    <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                      {issue.details.map((detail) => (
                        <span key={detail}>{detail}</span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {issue.fixable ? (
                        <button
                          type="button"
                          onClick={() => void handleFix(issue)}
                          disabled={Boolean(fixingId)}
                          className="rounded-lg bg-stone-800 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60 dark:bg-stone-700"
                        >
                          {fixingId === issue.id ? 'Düzeltiliyor...' : issue.fixLabel}
                        </button>
                      ) : null}
                      {issue.area === 'Krediler' && issue.id.includes('no-plan') ? (
                        <Link to="/krediler" className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-800 dark:text-stone-200">
                          Kredilere git
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </CardContent>
            </SurfaceCard>
          ))}
        </div>
      )}
    </section>
  )
}

function HealthStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2">
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}
