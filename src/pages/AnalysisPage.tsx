import { Archive, BarChart3, CalendarDays, CheckCircle2, Download, PieChart, Search, TrendingUp, Users, WalletCards } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { CrudPage, type FormField } from '../components/CrudPage'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { supabase } from '../lib/supabase'
import type {
  Asset,
  Budget,
  Card as FinanceCard,
  CardExpense,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  TransactionHistory,
} from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { dateInputValue, daysUntil, formatDate, isDateInMonth, monthlyOccurrenceDate, startOfMonth } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

type AnalysisData = {
  assets: Asset[]
  cards: FinanceCard[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  debts: Debt[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  transactionHistory: TransactionHistory[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  cardStatementArchives: CardStatementArchive[]
  budgets: Budget[]
  savingsGoals: SavingsGoal[]
}

type SearchItem = {
  type: string
  title: string
  subtitle: string
  amount: number | null
  date: string | null
}

type QueryError = {
  code?: string
  message?: string
}

type QueryResponse<T> = {
  data: T[] | null
  error: QueryError | null
}

const emptyAnalysisData: AnalysisData = {
  assets: [],
  cards: [],
  loans: [],
  loanInstallments: [],
  debts: [],
  payments: [],
  salaryHistory: [],
  transactionHistory: [],
  cardExpenses: [],
  cardInstallments: [],
  cardStatementArchives: [],
  budgets: [],
  savingsGoals: [],
}

const optionalTableLabels: Record<string, string> = {
  card_installments: 'kart taksitleri',
  card_statement_archives: 'ekstre arşivi',
  budgets: 'bütçeler',
  savings_goals: 'birikim hedefleri',
}

function isMissingSchemaCacheError(error: QueryError | null | undefined) {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === 'PGRST205' || message.includes('schema cache') || message.includes('Could not find the table')
}

function optionalRows<T>(response: QueryResponse<T>, tableName: string) {
  if (!response.error) return { rows: response.data ?? [], missingTable: null, error: null }
  if (isMissingSchemaCacheError(response.error)) return { rows: [] as T[], missingTable: tableName, error: null }
  return { rows: [] as T[], missingTable: null, error: response.error }
}

const budgetFields: FormField[] = [
  { name: 'month', label: 'Ay', type: 'date', required: true },
  { name: 'category', label: 'Kategori', type: 'select', options: expenseCategoryOptions },
  { name: 'limit_amount', label: 'Aylık limit', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'note', label: 'Not', type: 'textarea' },
]

const goalFields: FormField[] = [
  { name: 'name', label: 'Hedef adı', type: 'text', required: true },
  { name: 'target_amount', label: 'Hedef tutar', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'current_amount', label: 'Biriken tutar', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'target_date', label: 'Hedef tarih', type: 'date' },
  {
    name: 'status',
    label: 'Durum',
    type: 'select',
    options: [
      { label: 'Aktif', value: 'active' },
      { label: 'Tamamlandı', value: 'completed' },
    ],
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function sum<T>(rows: T[], selector: (row: T) => number) {
  return rows.reduce((total, row) => total + selector(row), 0)
}

function monthStartValue(value: FormDataEntryValue | null) {
  const date = value ? new Date(`${String(value)}T00:00:00`) : new Date()
  return dateInputValue(startOfMonth(Number.isNaN(date.getTime()) ? new Date() : date))
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
}

function getCurrentSalary(rows: SalaryHistory[]) {
  const today = new Date().toLocaleDateString('sv-SE')
  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  return ordered.filter((row) => row.effective_date <= today).at(-1) ?? ordered.at(-1) ?? null
}

function paymentInCurrentMonth(payment: Payment) {
  if (payment.status !== 'bekliyor') return false

  if (payment.recurrence === 'monthly') {
    const occurrence = monthlyOccurrenceDate(payment.recurrence_day)
    if (!occurrence) return false

    const dueDate = new Date(`${payment.due_date}T00:00:00`)
    const endDate = payment.recurrence_end_date ? new Date(`${payment.recurrence_end_date}T00:00:00`) : null
    return occurrence >= dueDate && (!endDate || occurrence <= endDate)
  }

  return isDateInMonth(payment.due_date)
}

function buildSearchItems(data: AnalysisData): SearchItem[] {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))

  return [
    ...data.assets.map((asset) => ({
      type: 'Varlık',
      title: asset.name,
      subtitle: asset.category,
      amount: asset.estimated_value_try,
      date: asset.updated_at,
    })),
    ...data.cards.map((card) => ({
      type: 'Kart',
      title: `${card.bank_name} ${card.card_name}`,
      subtitle: card.card_type === 'kredi_karti' ? 'Kredi kartı' : 'Banka kartı',
      amount: card.card_type === 'kredi_karti' ? card.debt_amount : card.current_balance,
      date: card.updated_at,
    })),
    ...data.cardExpenses.map((expense) => ({
      type: 'Kart harcaması',
      title: expense.description,
      subtitle: `${cardsById.get(expense.card_id)?.card_name ?? 'Kart'} · ${expense.category ?? 'Diğer'}`,
      amount: expense.amount,
      date: expense.spent_at,
    })),
    ...data.loans.map((loan) => ({
      type: 'Kredi',
      title: loan.loan_name,
      subtitle: loan.bank_name,
      amount: loan.remaining_amount,
      date: loan.end_date,
    })),
    ...data.payments.map((payment) => ({
      type: 'Ödeme',
      title: payment.title,
      subtitle: payment.category,
      amount: payment.amount,
      date: payment.due_date,
    })),
    ...data.debts.map((debt) => ({
      type: debt.direction === 'borç_aldım' ? 'Borç' : 'Alacak',
      title: debt.person_name,
      subtitle: debt.status,
      amount: debt.estimated_value_try,
      date: debt.due_date,
    })),
    ...data.budgets.map((budget) => ({
      type: 'Bütçe',
      title: budget.category,
      subtitle: formatMonth(budget.month),
      amount: budget.limit_amount,
      date: budget.month,
    })),
    ...data.savingsGoals.map((goal) => ({
      type: 'Birikim hedefi',
      title: goal.name,
      subtitle: goal.status === 'active' ? 'Aktif' : 'Tamamlandı',
      amount: goal.current_amount,
      date: goal.target_date,
    })),
    ...data.transactionHistory.map((row) => ({
      type: 'Geçmiş',
      title: row.title,
      subtitle: row.note ?? row.type,
      amount: row.amount,
      date: row.occurred_at,
    })),
  ].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
}

function csvValue(value: string | number | null | undefined) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function downloadCsv(items: SearchItem[]) {
  const rows = [
    ['Tur', 'Baslik', 'Detay', 'Tutar', 'Tarih'],
    ...items.map((item) => [item.type, item.title, item.subtitle, item.amount ?? '', item.date ?? '']),
  ]
  const csv = rows.map((row) => row.map(csvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `finans-rapor-${new Date().toLocaleDateString('sv-SE')}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function StatPill({ label, value, tone = 'stone' }: { label: string; value: string; tone?: 'emerald' | 'rose' | 'stone' }) {
  const toneClass = {
    emerald: 'text-emerald-700 dark:text-emerald-300',
    rose: 'text-rose-700 dark:text-rose-300',
    stone: 'text-foreground',
  }[tone]

  return (
    <div className="min-w-0 rounded-xl bg-muted/55 px-3 py-2">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-[clamp(0.76rem,3.2vw,1rem)] font-extrabold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}

function MonthlyReport({ data }: { data: AnalysisData }) {
  const monthKey = dateInputValue(startOfMonth())
  const salary = getCurrentSalary(data.salaryHistory)?.amount ?? 0
  const receivables = sum(
    data.debts.filter((debt) => debt.direction === 'borç_verdim' && debt.status === 'açık' && isDateInMonth(debt.due_date)),
    (debt) => debt.estimated_value_try,
  )
  const cardSpending = sum(
    data.cardExpenses.filter((expense) => isDateInMonth(expense.spent_at)),
    (expense) => expense.amount,
  )
  const cardInstallments = sum(
    data.cardInstallments.filter((installment) => installment.due_month === monthKey),
    (installment) => installment.amount,
  )
  const payments = sum(data.payments.filter(paymentInCurrentMonth), (payment) => payment.amount)
  const loanInstallments = sum(
    data.loanInstallments.filter((installment) => installment.status === 'bekliyor' && isDateInMonth(installment.due_date)),
    (installment) => installment.amount,
  )
  const personalDebts = sum(
    data.debts.filter((debt) => debt.direction === 'borç_aldım' && debt.status === 'açık' && isDateInMonth(debt.due_date)),
    (debt) => debt.estimated_value_try,
  )
  const income = salary + receivables
  const outflow = cardInstallments + payments + loanInstallments + personalDebts
  const net = income - outflow
  const reportRows = [
    { label: 'Kart taksitleri', value: cardInstallments },
    { label: 'Fatura/ödeme', value: payments },
    { label: 'Kredi taksidi', value: loanInstallments },
    { label: 'Kişisel borç', value: personalDebts },
  ]

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Aylık rapor</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{formatMonth(monthKey)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Download />
              PDF
            </Button>
            <div className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <BarChart3 />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Gelir" value={formatCurrency(income)} tone="emerald" />
          <StatPill label="Çıkış" value={formatCurrency(outflow)} tone="rose" />
          <StatPill label="Net" value={formatCurrency(net)} tone={net >= 0 ? 'emerald' : 'rose'} />
        </div>
        <div className="grid gap-2 min-[520px]:grid-cols-2">
          {reportRows.map((row) => (
            <div key={row.label} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
              <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-foreground">{formatCurrency(row.value)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Kart harcaması toplamı: {formatCurrency(cardSpending)} · Bütçeler kategori bazlı harcama tutarını kullanır.
        </p>
      </CardContent>
    </Card>
  )
}

function UpcomingInstallments({ data }: { data: AnalysisData }) {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const upcoming = data.cardInstallments
    .filter((item) => item.status === 'scheduled')
    .sort((a, b) => a.due_month.localeCompare(b.due_month) || a.installment_no - b.installment_no)
    .slice(0, 6)

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Yaklaşan taksitler</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{upcoming.length} planlı taksit</p>
          </div>
          <WalletCards className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {upcoming.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Planlı kart taksiti yok.</p>
        ) : (
          upcoming.map((item) => (
            <div key={item.id} className="rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{item.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {cardsById.get(item.card_id)?.card_name ?? 'Kart'} · {formatMonth(item.due_month)}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-white px-2 py-1 text-xs font-bold tabular-nums text-foreground dark:bg-stone-900">
                  {formatCurrency(item.amount)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function BudgetProgress({ budgets, expenses }: { budgets: Budget[]; expenses: CardExpense[] }) {
  const monthKey = dateInputValue(startOfMonth())
  const monthlyBudgets = budgets.filter((budget) => budget.month === monthKey)
  const monthlyExpenses = expenses.filter((expense) => isDateInMonth(expense.spent_at))

  if (monthlyBudgets.length === 0) {
    return <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Bu ay için bütçe eklediğinde kategori kullanımı burada görünecek.</p>
  }

  return (
    <div className="space-y-2">
      {monthlyBudgets.map((budget) => {
        const spent = sum(
          monthlyExpenses.filter((expense) => (expense.category ?? 'Diğer') === budget.category),
          (expense) => expense.amount,
        )
        const usageRate = budget.limit_amount > 0 ? Math.min(100, (spent / budget.limit_amount) * 100) : 0
        const isOver = spent > budget.limit_amount

        return (
          <div key={budget.id} className="rounded-xl bg-muted/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{budget.category}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatCurrency(spent)} / {formatCurrency(budget.limit_amount)}
                </p>
              </div>
              <Badge variant={isOver ? 'destructive' : 'secondary'}>%{Math.round(usageRate)}</Badge>
            </div>
            <Progress value={usageRate} className="mt-3 h-1.5" />
          </div>
        )
      })}
    </div>
  )
}

function GoalsProgress({ goals }: { goals: SavingsGoal[] }) {
  if (goals.length === 0) {
    return <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Birikim hedefi eklediğinde ilerleme burada görünecek.</p>
  }

  return (
    <div className="space-y-2">
      {goals.slice(0, 4).map((goal) => {
        const rate = goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0

        return (
          <div key={goal.id} className="rounded-xl bg-muted/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{goal.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatCurrency(goal.current_amount)} / {formatCurrency(goal.target_amount)}
                </p>
              </div>
              <Badge variant={goal.status === 'completed' ? 'default' : 'secondary'}>%{Math.round(rate)}</Badge>
            </div>
            <Progress value={rate} className="mt-3 h-1.5" />
          </div>
        )
      })}
    </div>
  )
}

function StatementArchive({ data }: { data: AnalysisData }) {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const archives = data.cardStatementArchives.slice(0, 6)

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Ekstre arşivi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{archives.length} son kayıt</p>
          </div>
          <Archive className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {archives.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Ekstre kesildiğinde arşiv burada tutulacak.</p>
        ) : (
          archives.map((archive) => (
            <div key={archive.id} className="rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{cardsById.get(archive.card_id)?.card_name ?? 'Kart'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(archive.statement_date)} · son ödeme {formatDate(archive.due_date)}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-white px-2 py-1 text-xs font-bold tabular-nums text-foreground dark:bg-stone-900">
                  {formatCurrency(archive.statement_debt_amount)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function SearchExport({ items }: { items: SearchItem[] }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
  const filteredItems = normalizedQuery
    ? items.filter((item) => `${item.type} ${item.title} ${item.subtitle}`.toLocaleLowerCase('tr-TR').includes(normalizedQuery))
    : items.slice(0, 12)

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Genel arama ve dışa aktarım</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Varlık, kart, borç, ödeme, bütçe ve geçmiş kayıtları.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => downloadCsv(filteredItems)}>
            <Download />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ara: market, kart, kredi, hedef..."
            className="w-full rounded-xl border border-stone-200 bg-white py-3 pl-10 pr-3 text-sm outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          />
        </label>
        <div className="space-y-2">
          {filteredItems.slice(0, 20).map((item, index) => (
            <div key={`${item.type}-${item.title}-${item.date}-${index}`} className="flex items-start justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{item.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.type} · {item.subtitle}
                </p>
              </div>
              {item.amount !== null ? (
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-white px-2 py-1 text-xs font-bold tabular-nums text-foreground dark:bg-stone-900">
                  {formatCurrency(item.amount)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

type CalendarEvent = {
  id: string
  date: string
  title: string
  amount: number
  tone: 'emerald' | 'rose' | 'amber' | 'stone'
}

function buildCalendarEvents(data: AnalysisData) {
  const monthKey = dateInputValue(startOfMonth())
  const events: CalendarEvent[] = []

  for (const payment of data.payments) {
    const occurrence = payment.recurrence === 'monthly' ? monthlyOccurrenceDate(payment.recurrence_day) : new Date(`${payment.due_date}T00:00:00`)
    if (payment.status !== 'bekliyor' || !occurrence || !isDateInMonth(occurrence)) continue

    events.push({
      id: `payment-${payment.id}`,
      date: dateInputValue(occurrence),
      title: payment.title,
      amount: payment.amount,
      tone: payment.amount_status === 'estimated' ? 'amber' : 'rose',
    })
  }

  for (const card of data.cards.filter((item) => item.card_type === 'kredi_karti' && item.statement_debt_amount > 0)) {
    const dueDate = monthlyOccurrenceDate(card.due_day)
    if (!dueDate || !isDateInMonth(dueDate)) continue
    events.push({
      id: `card-${card.id}`,
      date: dateInputValue(dueDate),
      title: `${card.card_name} ekstresi`,
      amount: card.statement_debt_amount,
      tone: 'rose',
    })
  }

  for (const installment of data.loanInstallments.filter((item) => item.status === 'bekliyor' && isDateInMonth(item.due_date))) {
    const loan = data.loans.find((item) => item.id === installment.loan_id)
    events.push({
      id: `loan-${installment.id}`,
      date: installment.due_date,
      title: loan ? `${loan.loan_name} taksidi` : 'Kredi taksidi',
      amount: installment.amount,
      tone: 'rose',
    })
  }

  for (const installment of data.cardInstallments.filter((item) => item.status === 'scheduled' && item.due_month === monthKey)) {
    events.push({
      id: `card-installment-${installment.id}`,
      date: installment.due_month,
      title: installment.description,
      amount: installment.amount,
      tone: 'amber',
    })
  }

  for (const debt of data.debts.filter((item) => item.status === 'açık' && item.due_date && isDateInMonth(item.due_date))) {
    events.push({
      id: `debt-${debt.id}`,
      date: debt.due_date ?? monthKey,
      title: debt.direction === 'borç_aldım' ? `${debt.person_name} borcu` : `${debt.person_name} alacağı`,
      amount: debt.estimated_value_try,
      tone: debt.direction === 'borç_aldım' ? 'rose' : 'emerald',
    })
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
}

function FinancialCalendar({ data }: { data: AnalysisData }) {
  const monthStart = startOfMonth()
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
  const firstOffset = (monthStart.getDay() + 6) % 7
  const events = buildCalendarEvents(data)
  const eventsByDate = new Map<string, CalendarEvent[]>()

  for (const event of events) {
    eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event])
  }

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Finans takvimi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{formatMonth(dateInputValue(monthStart))} içindeki nakit hareketleri.</p>
          </div>
          <CalendarDays className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">
          {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: firstOffset }, (_, index) => (
            <div key={`empty-${index}`} className="min-h-20 rounded-xl bg-transparent" />
          ))}
          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1
            const date = dateInputValue(new Date(monthStart.getFullYear(), monthStart.getMonth(), day))
            const dayEvents = eventsByDate.get(date) ?? []
            const dayTotal = dayEvents.reduce((total, event) => total + (event.tone === 'emerald' ? event.amount : -event.amount), 0)

            return (
              <div key={date} className="min-h-20 rounded-xl bg-muted/45 p-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-foreground">{day}</span>
                  {dayEvents.length > 0 ? (
                    <span className={`hidden text-[10px] font-bold tabular-nums min-[560px]:inline ${dayTotal >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                      {dayTotal >= 0 ? '+' : ''}
                      {formatCurrency(dayTotal).replace(',00', '')}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 2).map((event) => (
                    <CalendarEventPill key={event.id} event={event} />
                  ))}
                  {dayEvents.length > 2 ? <p className="text-[10px] font-semibold text-muted-foreground">+{dayEvents.length - 2} kayıt</p> : null}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function CalendarEventPill({ event }: { event: CalendarEvent }) {
  const toneClass = {
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
    rose: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
    stone: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200',
  }[event.tone]

  return <p className={`truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${toneClass}`}>{event.title}</p>
}

function CategorySpendingChart({ data }: { data: AnalysisData }) {
  const monthlyExpenses = data.cardExpenses.filter((expense) => isDateInMonth(expense.spent_at))
  const total = sum(monthlyExpenses, (expense) => expense.amount)
  const categoryTotals = Array.from(
    monthlyExpenses.reduce((map, expense) => {
      const category = expense.category || 'Diğer'
      map.set(category, (map.get(category) ?? 0) + expense.amount)
      return map
    }, new Map<string, number>()),
    ([category, amount]) => ({ category, amount }),
  ).sort((a, b) => b.amount - a.amount)

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Kategori harcaması</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Bu ay kart harcamalarının dağılımı.</p>
          </div>
          <PieChart className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {categoryTotals.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Bu ay kategorili kart harcaması yok.</p>
        ) : (
          categoryTotals.slice(0, 7).map((item) => {
            const rate = total > 0 ? Math.min(100, (item.amount / total) * 100) : 0
            return (
              <div key={item.category}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-semibold text-foreground">{item.category}</span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{formatCurrency(item.amount)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: `${rate}%` }} />
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

function CashFlowTrend({ data }: { data: AnalysisData }) {
  const salary = getCurrentSalary(data.salaryHistory)?.amount ?? 0
  const months = Array.from({ length: 6 }, (_, index) => new Date(new Date().getFullYear(), new Date().getMonth() - 5 + index, 1))
  const rows = months.map((month) => {
    const income = salary + sum(
      data.debts.filter((debt) => debt.direction === 'borç_verdim' && debt.status === 'açık' && isDateInMonth(debt.due_date, month)),
      (debt) => debt.estimated_value_try,
    )
    const outflow =
      sum(data.cardExpenses.filter((expense) => isDateInMonth(expense.spent_at, month)), (expense) => expense.amount) +
      sum(data.payments.filter((payment) => {
        if (payment.status !== 'bekliyor') return false
        if (payment.recurrence === 'monthly') return Boolean(monthlyOccurrenceDate(payment.recurrence_day, month))
        return isDateInMonth(payment.due_date, month)
      }), (payment) => payment.amount) +
      sum(data.loanInstallments.filter((installment) => isDateInMonth(installment.due_date, month)), (installment) => installment.amount) +
      sum(data.debts.filter((debt) => debt.direction === 'borç_aldım' && debt.status === 'açık' && isDateInMonth(debt.due_date, month)), (debt) => debt.estimated_value_try)

    return {
      label: new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(month),
      income,
      outflow,
      net: income - outflow,
    }
  })
  const maxValue = Math.max(...rows.map((row) => Math.max(row.income, row.outflow)), 1)

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>6 aylık ritim</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Gelir ve planlı çıkışların kaba karşılaştırması.</p>
          </div>
          <TrendingUp className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-6 items-end gap-2">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <div className="flex h-28 items-end gap-1 rounded-xl bg-muted/45 p-1.5">
                <div className="w-1/2 rounded-md bg-emerald-500" style={{ height: `${Math.max(8, (row.income / maxValue) * 100)}%` }} />
                <div className="w-1/2 rounded-md bg-rose-500" style={{ height: `${Math.max(8, (row.outflow / maxValue) * 100)}%` }} />
              </div>
              <p className="mt-1 truncate text-center text-[11px] font-bold text-muted-foreground">{row.label}</p>
              <p className={`truncate text-center text-[10px] font-bold tabular-nums ${row.net >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                {row.net >= 0 ? '+' : ''}
                {formatCurrency(row.net).replace(',00', '')}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function PeopleLedger({ debts }: { debts: Debt[] }) {
  const rows = Array.from(
    debts
      .filter((debt) => debt.status === 'açık')
      .reduce((map, debt) => {
        const current = map.get(debt.person_name) ?? { person: debt.person_name, borrowed: 0, receivable: 0, count: 0 }
        if (debt.direction === 'borç_aldım') current.borrowed += debt.estimated_value_try
        else current.receivable += debt.estimated_value_try
        current.count += 1
        map.set(debt.person_name, current)
        return map
      }, new Map<string, { person: string; borrowed: number; receivable: number; count: number }>()),
    ([, value]) => value,
  ).sort((a, b) => Math.abs(b.receivable - b.borrowed) - Math.abs(a.receivable - a.borrowed))

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Kişi bazlı bakiye</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Açık borç ve alacakları kişi profili gibi oku.</p>
          </div>
          <Users className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {rows.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Açık kişi borcu veya alacağı yok.</p>
        ) : (
          rows.slice(0, 6).map((row) => {
            const net = row.receivable - row.borrowed
            return (
              <div key={row.person} className="rounded-xl bg-muted/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{row.person}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.count} açık kayıt</p>
                  </div>
                  <Badge variant={net >= 0 ? 'default' : 'destructive'}>{net >= 0 ? 'Alacak' : 'Borç'}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <StatPill label="Alacak" value={formatCurrency(row.receivable)} tone="emerald" />
                  <StatPill label="Borç" value={formatCurrency(row.borrowed)} tone="rose" />
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

function MonthCloseAssistant({ data, missingTables }: { data: AnalysisData; missingTables: string[] }) {
  const monthKey = dateInputValue(startOfMonth())
  const overduePayments = data.payments.filter((payment) => payment.status === 'bekliyor' && (daysUntil(payment.due_date) ?? 0) < 0).length
  const checks = [
    { label: 'Bu ay bütçe tanımlı', done: data.budgets.some((budget) => budget.month === monthKey) },
    { label: 'Aktif birikim hedefi var', done: data.savingsGoals.some((goal) => goal.status === 'active') },
    { label: 'Gecikmiş ödeme yok', done: overduePayments === 0 },
    { label: 'Ekstre arşivi tutuluyor', done: data.cardStatementArchives.length > 0 },
    { label: 'Canlı migration tamam', done: missingTables.length === 0 },
  ]
  const completed = checks.filter((check) => check.done).length

  return (
    <Card className="border-0 bg-stone-950 text-white shadow-lg shadow-stone-950/10 ring-1 ring-stone-800 lg:col-span-12">
      <CardContent className="grid gap-4 p-4 min-[760px]:grid-cols-[1fr_auto] min-[760px]:items-center">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="text-emerald-300" />
            <h2 className="text-base font-extrabold">Ay kapanış asistanı</h2>
          </div>
          <p className="mt-1 text-sm text-white/65">
            {formatMonth(monthKey)} için {completed}/{checks.length} kontrol tamam. Raporu PDF olarak yazdırıp arşivleyebilirsin.
          </p>
        </div>
        <div className="grid gap-2 min-[560px]:grid-cols-5 min-[760px]:min-w-[560px]">
          {checks.map((check) => (
            <div key={check.label} className={`rounded-xl px-3 py-2 text-xs font-bold ${check.done ? 'bg-emerald-400/15 text-emerald-100' : 'bg-white/10 text-white/70'}`}>
              {check.label}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function SchemaMigrationNotice({ missingTables }: { missingTables: string[] }) {
  if (missingTables.length === 0) return null

  const labels = missingTables.map((table) => optionalTableLabels[table] ?? table).join(', ')

  return (
    <Card className="border-amber-200 bg-amber-50/80 shadow-sm ring-1 ring-amber-200/80 dark:border-amber-900 dark:bg-amber-950/20 dark:ring-amber-900/70 lg:col-span-12">
      <CardContent className="p-4">
        <p className="text-sm font-bold text-amber-900 dark:text-amber-100">Canlı veritabanı migration bekliyor</p>
        <p className="mt-1 text-sm text-amber-900/75 dark:text-amber-100/75">
          {labels} tabloları henüz canlı Supabase tarafında görünmüyor. Ekranı kırmadan mevcut verilerle devam ediyorum.
        </p>
      </CardContent>
    </Card>
  )
}

export function AnalysisPage() {
  const { user } = useAuth()
  const [data, setData] = useState<AnalysisData>(emptyAnalysisData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missingTables, setMissingTables] = useState<string[]>([])

  const loadAnalysis = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError('')
    setMissingTables([])

    const historyStart = new Date()
    historyStart.setMonth(historyStart.getMonth() - 6)

    const [
      assets,
      cards,
      loans,
      loanInstallments,
      debts,
      payments,
      salaryHistory,
      transactionHistory,
      cardExpenses,
      cardInstallments,
      cardStatementArchives,
      budgets,
      savingsGoals,
    ] = await Promise.all([
      supabase.from('assets').select('*'),
      supabase.from('cards').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('loan_installments').select('*'),
      supabase.from('debts').select('*'),
      supabase.from('payments').select('*'),
      supabase.from('salary_history').select('*').order('effective_date', { ascending: false }),
      supabase.from('transaction_history').select('*').gte('occurred_at', historyStart.toISOString()).order('occurred_at', { ascending: false }),
      supabase.from('card_expenses').select('*').order('spent_at', { ascending: false }),
      supabase.from('card_installments').select('*').order('due_month', { ascending: true }),
      supabase.from('card_statement_archives').select('*').order('statement_date', { ascending: false }),
      supabase.from('budgets').select('*').order('month', { ascending: false }),
      supabase.from('savings_goals').select('*').order('created_at', { ascending: false }),
    ])

    const cardInstallmentRows = optionalRows<CardInstallment>(cardInstallments, 'card_installments')
    const cardStatementArchiveRows = optionalRows<CardStatementArchive>(cardStatementArchives, 'card_statement_archives')
    const budgetRows = optionalRows<Budget>(budgets, 'budgets')
    const savingsGoalRows = optionalRows<SavingsGoal>(savingsGoals, 'savings_goals')

    const firstError = [
      assets.error,
      cards.error,
      loans.error,
      loanInstallments.error,
      debts.error,
      payments.error,
      salaryHistory.error,
      transactionHistory.error,
      cardExpenses.error,
      cardInstallmentRows.error,
      cardStatementArchiveRows.error,
      budgetRows.error,
      savingsGoalRows.error,
    ].find(Boolean)

    if (firstError) {
      setError(firstError.message ?? 'Analiz verileri yüklenemedi.')
      setLoading(false)
      return
    }

    setMissingTables(
      [cardInstallmentRows.missingTable, cardStatementArchiveRows.missingTable, budgetRows.missingTable, savingsGoalRows.missingTable].filter(
        Boolean,
      ) as string[],
    )
    setData({
      assets: assets.data ?? [],
      cards: cards.data ?? [],
      loans: loans.data ?? [],
      loanInstallments: loanInstallments.data ?? [],
      debts: debts.data ?? [],
      payments: payments.data ?? [],
      salaryHistory: salaryHistory.data ?? [],
      transactionHistory: transactionHistory.data ?? [],
      cardExpenses: cardExpenses.data ?? [],
      cardInstallments: cardInstallmentRows.rows,
      cardStatementArchives: cardStatementArchiveRows.rows,
      budgets: budgetRows.rows,
      savingsGoals: savingsGoalRows.rows,
    })
    setLoading(false)
  }, [user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAnalysis()
  }, [loadAnalysis])

  const searchItems = useMemo(() => buildSearchItems(data), [data])
  const canManageBudgets = !missingTables.includes('budgets')
  const canManageGoals = !missingTables.includes('savings_goals')

  if (error) {
    return <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <SchemaMigrationNotice missingTables={missingTables} />
        <MonthCloseAssistant data={data} missingTables={missingTables} />
        <MonthlyReport data={data} />
        <UpcomingInstallments data={data} />
        <FinancialCalendar data={data} />
        <CategorySpendingChart data={data} />
        <CashFlowTrend data={data} />
        <PeopleLedger debts={data.debts} />
        <SearchExport items={searchItems} />
        <StatementArchive data={data} />
      </div>

      {loading ? <p className="rounded-xl bg-white p-4 text-sm text-muted-foreground dark:bg-stone-900">Analiz verileri yükleniyor...</p> : null}

      {canManageBudgets ? (
      <CrudPage
        table="budgets"
        pageTitle="Bütçeler"
        addLabel="Bütçe ekle"
        fields={budgetFields}
        emptyTitle="Henüz bütçe yok"
        emptyDescription="Kategori bazlı aylık limit ekleyerek harcama takibini başlatabilirsin."
        orderBy="month"
        orderAscending={false}
        renderBeforeList={({ loading, rows }) =>
          !loading ? <BudgetProgress budgets={rows as Budget[]} expenses={data.cardExpenses} /> : null
        }
        getInitialValues={(row?: Budget) => ({
          month: row?.month ?? dateInputValue(startOfMonth()),
          category: row?.category ?? expenseCategoryOptions[0]?.value ?? 'Diğer',
          limit_amount: row?.limit_amount ?? 0,
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId) => ({
          user_id: userId,
          month: monthStartValue(formData.get('month')),
          category: String(formData.get('category') ?? 'Diğer'),
          limit_amount: parseNumber(formData.get('limit_amount')),
          note: String(formData.get('note') ?? '') || null,
        })}
        renderTitle={(row) => row.category}
        renderSubtitle={(row) => formatMonth(row.month)}
        renderDetails={(row) => [`Limit: ${formatCurrency(row.limit_amount)}`]}
      />
      ) : null}

      {canManageGoals ? (
      <CrudPage
        table="savings_goals"
        pageTitle="Birikim hedefleri"
        addLabel="Hedef ekle"
        fields={goalFields}
        emptyTitle="Henüz birikim hedefi yok"
        emptyDescription="Araba, tatil veya acil durum fonu gibi hedeflerini buradan takip edebilirsin."
        orderBy="created_at"
        orderAscending={false}
        renderBeforeList={({ loading, rows }) => (!loading ? <GoalsProgress goals={rows as SavingsGoal[]} /> : null)}
        getInitialValues={(row?: SavingsGoal) => ({
          name: row?.name ?? '',
          target_amount: row?.target_amount ?? 0,
          current_amount: row?.current_amount ?? 0,
          target_date: row?.target_date ?? '',
          status: row?.status ?? 'active',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId) => ({
          user_id: userId,
          name: String(formData.get('name') ?? '').trim(),
          target_amount: parseNumber(formData.get('target_amount')),
          current_amount: parseNumber(formData.get('current_amount')),
          target_date: String(formData.get('target_date') ?? '') || null,
          status: formData.get('status') as SavingsGoal['status'],
          note: String(formData.get('note') ?? '') || null,
        })}
        renderTitle={(row) => row.name}
        renderSubtitle={(row) => (row.status === 'active' ? 'Aktif hedef' : 'Tamamlandı')}
        renderDetails={(row) => [
          `Biriken: ${formatCurrency(row.current_amount)}`,
          `Hedef: ${formatCurrency(row.target_amount)}`,
          `Tarih: ${formatDate(row.target_date)}`,
        ]}
        getCardClassName={(row) =>
          row.status === 'completed'
            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
            : 'border-stone-200'
        }
      />
      ) : null}
    </section>
  )
}
