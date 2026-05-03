import { CalendarDays, TrendingUp, TrendingDown, Wallet, CreditCard, Landmark, AlertCircle, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Asset, Card, Debt, Loan, Payment } from '../types/database'
import { daysUntil, formatDate, isUpcomingDate, nextMonthlyDate } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
import { EmptyState } from '../components/EmptyState'

type DashboardData = {
  assets: Asset[]
  cards: Card[]
  loans: Loan[]
  debts: Debt[]
  payments: Payment[]
}

const emptyData: DashboardData = {
  assets: [],
  cards: [],
  loans: [],
  debts: [],
  payments: [],
}

const UPCOMING_DAYS = 30

function sum<T>(rows: T[], selector: (row: T) => number) {
  return rows.reduce((total, row) => total + selector(row), 0)
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError('')

    const [assets, cards, loans, debts, payments] = await Promise.all([
      supabase.from('assets').select('*'),
      supabase.from('cards').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('debts').select('*'),
      supabase.from('payments').select('*'),
    ])

    const firstError = [assets.error, cards.error, loans.error, debts.error, payments.error].find(Boolean)
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    setData({
      assets: assets.data ?? [],
      cards: cards.data ?? [],
      loans: loans.data ?? [],
      debts: debts.data ?? [],
      payments: payments.data ?? [],
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDashboard()
  }, [loadDashboard])

  const summary = useMemo(() => {
    const totalAssets = sum(data.assets, (asset) => asset.estimated_value_try)
    const totalCreditCardDebt = sum(
      data.cards.filter((card) => card.card_type === 'kredi_karti'),
      (card) => card.debt_amount,
    )
    const totalCreditLimit = sum(
      data.cards.filter((card) => card.card_type === 'kredi_karti'),
      (card) => card.credit_limit,
    )
    const totalLoanDebt = sum(
      data.loans.filter((loan) => loan.status === 'active'),
      (loan) => loan.remaining_amount,
    )
    const totalLoanMonthlyPayment = sum(
      data.loans.filter((loan) => loan.status === 'active'),
      (loan) => loan.monthly_payment,
    )
    const openDebts = data.debts.filter((debt) => debt.status === 'açık')
    const totalPersonalDebts = sum(
      openDebts.filter((debt) => debt.direction === 'borç_aldım'),
      (debt) => debt.estimated_value_try,
    )
    const totalReceivables = sum(
      openDebts.filter((debt) => debt.direction === 'borç_verdim'),
      (debt) => debt.estimated_value_try,
    )
    const totalDebts = totalCreditCardDebt + totalLoanDebt + totalPersonalDebts
    const netWorth = totalAssets + totalReceivables - totalDebts

    return {
      totalAssets,
      totalDebts,
      netWorth,
      totalCreditCardDebt,
      totalCreditLimit,
      totalLoanDebt,
      totalLoanMonthlyPayment,
      totalPersonalDebts,
      totalReceivables,
    }
  }, [data])

  const upcomingItems = useMemo(() => {
    const manualPayments = data.payments
      .filter((payment) => payment.status === 'bekliyor' && isUpcomingDate(payment.due_date, UPCOMING_DAYS))
      .map((payment) => ({
        id: `payment-${payment.id}`,
        title: `Ödeme · ${payment.title}`,
        value: formatCurrency(payment.amount),
        date: formatDate(payment.due_date),
        sortTime: new Date(`${payment.due_date}T00:00:00`).getTime(),
      }))

    const creditCards = data.cards
      .filter((card) => card.card_type === 'kredi_karti' && card.due_day)
      .map((card) => ({ card, dueDate: nextMonthlyDate(card.due_day) }))
      .filter((item) => {
        const remaining = daysUntil(item.dueDate)
        return remaining !== null && remaining >= 0 && remaining <= UPCOMING_DAYS
      })
      .map(({ card, dueDate }) => ({
        id: `card-${card.id}`,
        title: `Kart · ${card.bank_name} · ${card.card_name}`,
        value: formatCurrency(card.debt_amount),
        date: formatMonthDay(dueDate),
        sortTime: dueDate?.getTime() ?? 0,
      }))

    const loanInstallments = data.loans
      .filter((loan) => loan.status === 'active' && loan.installment_day && loan.remaining_installments > 0)
      .map((loan) => ({ loan, dueDate: nextMonthlyDate(loan.installment_day) }))
      .filter((item) => {
        const remaining = daysUntil(item.dueDate)
        return remaining !== null && remaining >= 0 && remaining <= UPCOMING_DAYS
      })
      .map(({ loan, dueDate }) => ({
        id: `loan-${loan.id}`,
        title: `Kredi · ${loan.bank_name} · ${loan.loan_name}`,
        value: formatCurrency(loan.monthly_payment),
        date: formatMonthDay(dueDate),
        sortTime: dueDate?.getTime() ?? 0,
      }))

    return [...manualPayments, ...creditCards, ...loanInstallments].sort((a, b) => a.sortTime - b.sortTime).slice(0, 10)
  }, [data.cards, data.loans, data.payments])

  if (loading) {
    return <p className="rounded-lg bg-white p-4 text-sm text-stone-500 dark:bg-stone-900 dark:text-stone-400">Özet yükleniyor...</p>
  }

  if (error) {
    return <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <ModernStatCard
          label="Toplam varlık"
          value={formatCurrency(summary.totalAssets)}
          icon={<Wallet size={20} />}
          color="indigo"
        />
        <ModernStatCard
          label="Toplam borç"
          value={formatCurrency(summary.totalDebts)}
          icon={<AlertCircle size={20} />}
          color="rose"
        />
        <ModernStatCard
          label="Net değer"
          value={formatCurrency(summary.netWorth)}
          icon={summary.netWorth >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          color={summary.netWorth >= 0 ? 'emerald' : 'rose'}
          highlight
        />
        <ModernStatCard
          label="Toplam limit"
          value={formatCurrency(summary.totalCreditLimit)}
          icon={<CreditCard size={20} />}
          color="violet"
        />
        <ModernStatCard
          label="Kart borcu"
          value={formatCurrency(summary.totalCreditCardDebt)}
          icon={<CreditCard size={20} />}
          color="amber"
        />
        <ModernStatCard
          label="Kredi borcu"
          value={formatCurrency(summary.totalLoanDebt)}
          icon={<Landmark size={20} />}
          color="amber"
        />
        <ModernStatCard
          label="Kredi ödemesi"
          value={formatCurrency(summary.totalLoanMonthlyPayment)}
          icon={<Landmark size={20} />}
          color="rose"
        />
        <ModernStatCard
          label="Kişisel borç"
          value={formatCurrency(summary.totalPersonalDebts)}
          icon={<ArrowDownRight size={20} />}
          color="rose"
        />
        <ModernStatCard
          label="Alacak"
          value={formatCurrency(summary.totalReceivables)}
          icon={<ArrowUpRight size={20} />}
          color="emerald"
        />
      </div>

      <UpcomingSection title="Yaklaşan ödemeler">
        {upcomingItems.length === 0 ? (
          <EmptyState title="Yaklaşan ödeme yok" description="Önümüzdeki 30 gün için ödeme, kart günü veya kredi taksidi bulunmuyor." />
        ) : (
          upcomingItems.map((item) => (
            <ModernUpcomingRow key={item.id} title={item.title} value={item.value} date={item.date} />
          ))
        )}
      </UpcomingSection>
    </section>
  )
}

function formatMonthDay(date: Date | null) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(date)
}

function UpcomingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-bold text-stone-950 dark:text-stone-50">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function ModernStatCard({ label, value, icon, color, highlight }: { label: string; value: string; icon: React.ReactNode; color: 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet'; highlight?: boolean }) {
  const colorClasses = {
    indigo: 'from-indigo-500 to-indigo-600 dark:from-indigo-600 dark:to-indigo-700',
    emerald: 'from-emerald-500 to-emerald-600 dark:from-emerald-600 dark:to-emerald-700',
    rose: 'from-rose-500 to-rose-600 dark:from-rose-600 dark:to-rose-700',
    amber: 'from-amber-500 to-amber-600 dark:from-amber-600 dark:to-amber-700',
    violet: 'from-violet-500 to-violet-600 dark:from-violet-600 dark:to-violet-700',
  }

  const bgClasses = {
    indigo: 'bg-indigo-50 dark:bg-indigo-950/30',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/30',
    rose: 'bg-rose-50 dark:bg-rose-950/30',
    amber: 'bg-amber-50 dark:bg-amber-950/30',
    violet: 'bg-violet-50 dark:bg-violet-950/30',
  }

  const iconBgClasses = {
    indigo: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-300',
    rose: 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300',
    amber: 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300',
    violet: 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-300',
  }

  return (
    <div className={`relative overflow-hidden rounded-xl border-0 shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 ${highlight ? 'col-span-2 p-5' : 'p-4'} ${bgClasses[color]}`}>
      <div className={`absolute -right-4 -top-4 rounded-full opacity-10 bg-gradient-to-br ${colorClasses[color]} ${highlight ? 'size-32' : 'size-20'}`} />
      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">{label}</p>
          <p className={`mt-1 font-extrabold tracking-tight text-stone-900 dark:text-stone-100 ${highlight ? 'text-2xl' : 'text-lg'}`}>{value}</p>
        </div>
        <div className={`flex shrink-0 items-center justify-center rounded-xl ${iconBgClasses[color]} ${highlight ? 'size-12' : 'size-10'}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function ModernUpcomingRow({ title, value, date }: { title: string; value: string; date: string }) {
  return (
    <article className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-md transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 hover:border-indigo-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-indigo-700">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <CalendarDays size={14} className="text-stone-400 dark:text-stone-500" />
          {date}
        </p>
      </div>
      <div className="shrink-0 rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-indigo-100 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-indigo-900/30">
        {value}
      </div>
    </article>
  )
}
