import { CalendarDays, TrendingUp, TrendingDown, Wallet, CreditCard, Landmark, AlertCircle, ArrowUpRight, ArrowDownRight, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import type { Asset, Card, Debt, DismissedUpcomingItem, Loan, LoanInstallment, Payment, TransactionHistory, UpcomingDismissalSource } from '../types/database'
import { daysUntil, formatDate, isUpcomingDate, nextMonthlyDate } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
import { EmptyState } from '../components/EmptyState'

type DashboardData = {
  assets: Asset[]
  cards: Card[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  debts: Debt[]
  payments: Payment[]
  transactionHistory: TransactionHistory[]
  dismissedUpcomingItems: DismissedUpcomingItem[]
}

const emptyData: DashboardData = {
  assets: [],
  cards: [],
  loans: [],
  loanInstallments: [],
  debts: [],
  payments: [],
  transactionHistory: [],
  dismissedUpcomingItems: [],
}

const UPCOMING_DAYS = 30

type UpcomingItem = {
  id: string
  recordId: string
  source: UpcomingDismissalSource
  title: string
  value: string
  date: string
  sortTime: number
}

function sum<T>(rows: T[], selector: (row: T) => number) {
  return rows.reduce((total, row) => total + selector(row), 0)
}

export function DashboardPage() {
  const { user } = useAuth()
  const [data, setData] = useState<DashboardData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError('')

    const historyStart = new Date()
    historyStart.setMonth(historyStart.getMonth() - 3)

    const [assets, cards, loans, loanInstallments, debts, payments, transactionHistory, dismissedUpcomingItems] = await Promise.all([
      supabase.from('assets').select('*'),
      supabase.from('cards').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('loan_installments').select('*'),
      supabase.from('debts').select('*'),
      supabase.from('payments').select('*'),
      supabase.from('transaction_history').select('*').gte('occurred_at', historyStart.toISOString()).order('occurred_at', { ascending: false }),
      supabase.from('dismissed_upcoming_items').select('*'),
    ])

    const firstError = [
      assets.error,
      cards.error,
      loans.error,
      loanInstallments.error,
      debts.error,
      payments.error,
      transactionHistory.error,
      dismissedUpcomingItems.error,
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
      transactionHistory: transactionHistory.data ?? [],
      dismissedUpcomingItems: dismissedUpcomingItems.data ?? [],
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    function reloadWhenVisible() {
      if (document.visibilityState === 'visible') void loadDashboard()
    }

    window.addEventListener('focus', loadDashboard)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      window.removeEventListener('focus', loadDashboard)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
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
    const dismissedKeys = new Set(data.dismissedUpcomingItems.map((item) => item.item_key))
    const loansById = new Map(data.loans.map((loan) => [loan.id, loan]))
    const manualPayments = data.payments
      .filter((payment) => payment.status === 'bekliyor' && isUpcomingDate(payment.due_date, UPCOMING_DAYS))
      .map((payment) => ({
        id: `payment-${payment.id}`,
        recordId: payment.id,
        source: 'payment' as const,
        title: `Ödeme · ${payment.title}`,
        value: formatCurrency(payment.amount),
        date: formatDate(payment.due_date),
        sortTime: new Date(`${payment.due_date}T00:00:00`).getTime(),
      }))

    const creditCards = data.cards
      .filter((card) => card.card_type === 'kredi_karti' && card.due_day && card.debt_amount > 0)
      .map((card) => ({ card, dueDate: nextMonthlyDate(card.due_day) }))
      .filter((item) => {
        const remaining = daysUntil(item.dueDate)
        return remaining !== null && remaining >= 0 && remaining <= UPCOMING_DAYS
      })
      .map(({ card, dueDate }) => ({
        id: `card-${card.id}-${dateInputValue(dueDate)}`,
        recordId: card.id,
        source: 'card' as const,
        title: `Kart · ${card.bank_name} · ${card.card_name}`,
        value: formatCurrency(card.debt_amount),
        date: formatMonthDay(dueDate),
        sortTime: dueDate?.getTime() ?? 0,
      }))

    const loanInstallments = data.loanInstallments
      .filter((installment) => installment.status === 'bekliyor' && isUpcomingDate(installment.due_date, UPCOMING_DAYS))
      .map((installment) => {
        const loan = loansById.get(installment.loan_id)
        return {
          id: `loan-installment-${installment.id}`,
          recordId: installment.id,
          source: 'loan_installment' as const,
          title: loan ? `Kredi · ${loan.bank_name} · ${loan.loan_name}` : 'Kredi taksidi',
          value: formatCurrency(installment.amount),
          date: formatDate(installment.due_date),
          sortTime: new Date(`${installment.due_date}T00:00:00`).getTime(),
        }
      })

    const personalDebts = data.debts
      .filter((debt) => debt.direction === 'borç_aldım' && debt.status === 'açık' && isUpcomingDate(debt.due_date, UPCOMING_DAYS))
      .map((debt) => ({
        id: `debt-${debt.id}`,
        recordId: debt.id,
        source: 'debt' as const,
        title: `Borç · ${debt.person_name}`,
        value: formatCurrency(debt.estimated_value_try),
        date: formatDate(debt.due_date),
        sortTime: new Date(`${debt.due_date}T00:00:00`).getTime(),
      }))

    const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))
    const legacyLoanInstallments = data.loans
      .filter((loan) => !plannedLoanIds.has(loan.id) && loan.status === 'active' && loan.installment_day && loan.remaining_installments > 0)
      .map((loan) => ({ loan, dueDate: nextMonthlyDate(loan.installment_day) }))
      .filter((item) => {
        const remaining = daysUntil(item.dueDate)
        return remaining !== null && remaining >= 0 && remaining <= UPCOMING_DAYS
      })
      .map(({ loan, dueDate }) => ({
        id: `loan-${loan.id}-${dateInputValue(dueDate)}`,
        recordId: loan.id,
        source: 'loan_installment' as const,
        title: `Kredi · ${loan.bank_name} · ${loan.loan_name}`,
        value: formatCurrency(loan.monthly_payment),
        date: formatMonthDay(dueDate),
        sortTime: dueDate?.getTime() ?? 0,
      }))

    return [...manualPayments, ...creditCards, ...loanInstallments, ...personalDebts, ...legacyLoanInstallments]
      .filter((item) => !dismissedKeys.has(item.id))
      .sort((a, b) => a.sortTime - b.sortTime)
      .slice(0, 10)
  }, [data.cards, data.debts, data.dismissedUpcomingItems, data.loanInstallments, data.loans, data.payments])

  async function dismissUpcomingItem(item: UpcomingItem) {
    if (!user) return

    if (item.source === 'payment') {
      const { error: deleteError } = await supabase.from('payments').delete().eq('id', item.recordId)
      if (deleteError) {
        setError(deleteError.message)
        return
      }
    } else {
      const { error: dismissError } = await supabase.from('dismissed_upcoming_items').upsert(
        {
          user_id: user.id,
          item_key: item.id,
          source: item.source,
        },
        { onConflict: 'user_id,item_key' },
      )
      if (dismissError) {
        setError(dismissError.message)
        return
      }
    }

    await loadDashboard()
  }

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
            <ModernUpcomingRow key={item.id} item={item} onDismiss={dismissUpcomingItem} />
          ))
        )}
      </UpcomingSection>

      <HistorySection rows={data.transactionHistory} />
    </section>
  )
}

function dateInputValue(date: Date | null) {
  return date ? date.toLocaleDateString('sv-SE') : 'unknown'
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

function ModernUpcomingRow({ item, onDismiss }: { item: UpcomingItem; onDismiss: (item: UpcomingItem) => Promise<void> }) {
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => void onDismiss(item)}
        className="absolute inset-y-0 right-0 grid w-16 place-items-center bg-rose-600 text-white"
        aria-label="Yaklaşan ödemeyi sil"
      >
        <Trash2 size={18} />
      </button>
      <article
        onPointerDown={(event) => setDragStart(event.clientX)}
        onPointerUp={(event) => {
          if (dragStart === null) return
          const delta = event.clientX - dragStart
          if (delta < -45) setIsOpen(true)
          if (delta > 30) setIsOpen(false)
          setDragStart(null)
        }}
        className={`relative flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-md transition-all duration-300 hover:border-indigo-300 hover:shadow-lg dark:border-stone-800 dark:bg-stone-900 dark:hover:border-indigo-700 ${
          isOpen ? '-translate-x-16' : 'translate-x-0'
        }`}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{item.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
            <CalendarDays size={14} className="text-stone-400 dark:text-stone-500" />
            {item.date}
          </p>
        </div>
        <div className="shrink-0 rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-indigo-100 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-indigo-900/30">
          {item.value}
        </div>
      </article>
    </div>
  )
}

function HistorySection({ rows }: { rows: TransactionHistory[] }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-bold text-stone-950 dark:text-stone-50">Son 3 ay işlem geçmişi</h2>
      {rows.length === 0 ? (
        <EmptyState title="İşlem geçmişi yok" description="Ödemeler, transferler ve borç kapatma işlemleri burada görünecek." />
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 20).map((row) => (
            <article
              key={row.id}
              className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{row.title}</p>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{formatHistoryDate(row.occurred_at)}</p>
                </div>
                {row.amount !== null ? (
                  <span className="shrink-0 rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-semibold text-stone-900 dark:bg-stone-800 dark:text-stone-100">
                    {formatCurrency(row.amount)}
                  </span>
                ) : null}
              </div>
              {row.note ? <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">{row.note}</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
