import { CalendarDays } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Asset, Card, Debt, Loan, Payment } from '../types/database'
import { daysUntil, formatDate, isUpcomingDate, nextMonthlyDate } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
import { EmptyState } from '../components/EmptyState'
import { StatCard } from '../components/StatCard'

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
      totalPersonalDebts,
      totalReceivables,
    }
  }, [data])

  const upcomingPayments = useMemo(
    () =>
      data.payments
        .filter((payment) => payment.status === 'bekliyor' && isUpcomingDate(payment.due_date))
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 5),
    [data.payments],
  )

  const upcomingCards = useMemo(
    () =>
      data.cards
        .filter((card) => card.card_type === 'kredi_karti' && card.due_day)
        .map((card) => ({ card, dueDate: nextMonthlyDate(card.due_day) }))
        .filter((item) => {
          const remaining = daysUntil(item.dueDate)
          return remaining !== null && remaining >= 0 && remaining <= 30
        })
        .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
        .slice(0, 5),
    [data.cards],
  )

  const upcomingLoans = useMemo(
    () =>
      data.loans
        .filter((loan) => loan.status === 'active' && loan.installment_day)
        .map((loan) => ({ loan, dueDate: nextMonthlyDate(loan.installment_day) }))
        .filter((item) => {
          const remaining = daysUntil(item.dueDate)
          return remaining !== null && remaining >= 0 && remaining <= 30
        })
        .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
        .slice(0, 5),
    [data.loans],
  )

  if (loading) {
    return <p className="rounded-lg bg-white p-4 text-sm text-stone-500 dark:bg-stone-900 dark:text-stone-400">Özet yükleniyor...</p>
  }

  if (error) {
    return <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
  }

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Toplam varlık" value={formatCurrency(summary.totalAssets)} tone="good" />
        <StatCard label="Toplam borç" value={formatCurrency(summary.totalDebts)} tone="bad" />
        <StatCard label="Net değer" value={formatCurrency(summary.netWorth)} />
        <StatCard label="Toplam limit" value={formatCurrency(summary.totalCreditLimit)} />
        <StatCard label="Kart borcu" value={formatCurrency(summary.totalCreditCardDebt)} />
        <StatCard label="Kredi borcu" value={formatCurrency(summary.totalLoanDebt)} />
        <StatCard label="Kişisel borç" value={formatCurrency(summary.totalPersonalDebts)} />
        <StatCard label="Alacak" value={formatCurrency(summary.totalReceivables)} tone="good" />
      </div>

      <UpcomingSection title="Yaklaşan ödemeler">
        {upcomingPayments.length === 0 ? (
          <EmptyState title="Yaklaşan ödeme yok" description="Önümüzdeki 30 gün için bekleyen ödeme bulunmuyor." />
        ) : (
          upcomingPayments.map((payment) => (
            <UpcomingRow
              key={payment.id}
              title={payment.title}
              value={formatCurrency(payment.amount)}
              date={formatDate(payment.due_date)}
            />
          ))
        )}
      </UpcomingSection>

      <UpcomingSection title="Kart son ödeme günleri">
        {upcomingCards.length === 0 ? (
          <EmptyState title="Yaklaşan kart günü yok" description="Önümüzdeki 30 gün için kart son ödeme günü yok." />
        ) : (
          upcomingCards.map(({ card, dueDate }) => (
            <UpcomingRow
              key={card.id}
              title={`${card.bank_name} · ${card.card_name}`}
              value={formatCurrency(card.debt_amount)}
              date={dueDate ? new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(dueDate) : '-'}
            />
          ))
        )}
      </UpcomingSection>

      <UpcomingSection title="Kredi taksitleri">
        {upcomingLoans.length === 0 ? (
          <EmptyState title="Yaklaşan kredi taksidi yok" description="Önümüzdeki 30 gün için aktif kredi taksidi yok." />
        ) : (
          upcomingLoans.map(({ loan, dueDate }) => (
            <UpcomingRow
              key={loan.id}
              title={`${loan.bank_name} · ${loan.loan_name}`}
              value={formatCurrency(loan.monthly_payment)}
              date={dueDate ? new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(dueDate) : '-'}
            />
          ))
        )}
      </UpcomingSection>
    </section>
  )
}

function UpcomingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-stone-950 dark:text-stone-50">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function UpcomingRow({ title, value, date }: { title: string; value: string; date: string }) {
  return (
    <article className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{title}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
          <CalendarDays size={14} />
          {date}
        </p>
      </div>
      <p className="shrink-0 text-sm font-semibold text-stone-900 dark:text-stone-100">{value}</p>
    </article>
  )
}
