import { Archive, BarChart3, Download, Search, WalletCards } from 'lucide-react'
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
import { dateInputValue, formatDate, isDateInMonth, monthlyOccurrenceDate, startOfMonth } from '../utils/date'
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
      subtitle: `${cardsById.get(expense.card_id)?.card_name ?? 'Kart'} · ${expense.category}`,
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
          <div className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            <BarChart3 />
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
          monthlyExpenses.filter((expense) => expense.category === budget.category),
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

export function AnalysisPage() {
  const { user } = useAuth()
  const [data, setData] = useState<AnalysisData>(emptyAnalysisData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadAnalysis = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError('')

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
      cardInstallments.error,
      cardStatementArchives.error,
      budgets.error,
      savingsGoals.error,
    ].find(Boolean)

    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

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
      cardInstallments: cardInstallments.data ?? [],
      cardStatementArchives: cardStatementArchives.data ?? [],
      budgets: budgets.data ?? [],
      savingsGoals: savingsGoals.data ?? [],
    })
    setLoading(false)
  }, [user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAnalysis()
  }, [loadAnalysis])

  const searchItems = useMemo(() => buildSearchItems(data), [data])

  if (error) {
    return <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <MonthlyReport data={data} />
        <UpcomingInstallments data={data} />
        <SearchExport items={searchItems} />
        <StatementArchive data={data} />
      </div>

      {loading ? <p className="rounded-xl bg-white p-4 text-sm text-muted-foreground dark:bg-stone-900">Analiz verileri yükleniyor...</p> : null}

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
    </section>
  )
}
