import { useMemo } from 'react'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { CrudPage, type FormField } from '../components/CrudPage'
import { KasaModuPanel } from '../components/finance/KasaModuPanel'
import { SavingsGoalsPanel } from '../components/finance/SavingsGoalsPanel'
import type { Budget } from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { dateInputValue, endOfMonth, startOfMonth } from '../utils/date'
import { parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { formatMonth } from '../utils/analysisView'
import { buildFinancialPosition, buildMonthlyCashFlow } from '../utils/financeSummary'
import { buildSafeToSpend } from '../utils/safeToSpend'
import { readSafeToSpendBuffer } from '../hooks/useSafeToSpend'
import { SERIT_FILL, useSeritAmount, type SeritTone } from '../components/serit'
import { buildBudgetUsage } from '../utils/budgetAlerts'
import { sumTL } from '../utils/money'
import { BudgetProgress } from './AnalysisPage.panels'

const budgetFields: FormField[] = [
  { name: 'month', label: 'Ay', type: 'date', required: true },
  { name: 'category', label: 'Kategori', type: 'select', options: expenseCategoryOptions },
  { name: 'limit_amount', label: 'Aylık limit', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function monthStartValue(value: FormDataEntryValue | null) {
  const date = value ? new Date(`${String(value)}T00:00:00`) : new Date()
  return dateInputValue(startOfMonth(Number.isNaN(date.getTime()) ? new Date() : date))
}

export function PlanningPage() {
  const { formatAmount } = useBalancePrivacy()
  const snapshotQuery = useFinanceSnapshot()
  const seritAmount = useSeritAmount()
  const loading = snapshotQuery.isPending

  const missingTables = useMemo(
    () => snapshotQuery.data?.missingTables ?? [],
    [snapshotQuery.data],
  )

  const cardExpenses = useMemo(
    () => snapshotQuery.data?.cardExpenses ?? [],
    [snapshotQuery.data],
  )

  // Likit nakit (banka + nakit varlık) ve bu ayki harcanabilir (safeToSpend).
  // Likit → kasa modu kova hesabı; surplus → birikim önerisi "ayır / ara ver" bağlamı.
  // Dashboard kahraman rakamıyla aynı hesap (useSafeToSpend).
  const { liquidCash, monthlySurplus } = useMemo(() => {
    const data = snapshotQuery.data
    if (!data) return { liquidCash: 0, monthlySurplus: undefined as number | undefined }
    const position = buildFinancialPosition(data)
    const cashFlow = buildMonthlyCashFlow(data)
    const surplus = buildSafeToSpend({
      liquidCash: position.totalCashAssets,
      expectedIncome: cashFlow.expectedIncome,
      remainingOutflow: cashFlow.remainingOutflow,
      buffer: readSafeToSpendBuffer(),
    }).amount
    return { liquidCash: position.totalCashAssets, monthlySurplus: surplus }
  }, [snapshotQuery.data])

  // Ay bütçesi toplamı: kategori limitlerinin ve harcamalarının toplamı.
  // "Hız" cümlesi ayın kaçıncı gününde olduğumuzla harcama oranını karşılaştırır —
  // %60 harcama ayın %30'unda alarm, %90'ında normaldir.
  const budgetTotals = useMemo(() => {
    const budgets = snapshotQuery.data?.budgets ?? []
    const currentMonth = dateInputValue(startOfMonth())
    const usage = buildBudgetUsage(budgets.filter((budget) => budget.month === currentMonth), cardExpenses)
    if (usage.length === 0) return null

    const limit = sumTL(usage.map((item) => item.limit))
    const spent = sumTL(usage.map((item) => item.spent))
    if (limit <= 0) return null

    const usageRate = (spent / limit) * 100
    const today = new Date()
    const monthProgress = (today.getDate() / endOfMonth(today).getDate()) * 100
    const ahead = usageRate - monthProgress

    return {
      limit,
      spent,
      usageRate,
      tone: (usageRate > 100 ? 'danger' : usageRate >= 80 ? 'warning' : 'brand') as SeritTone,
      pace:
        ahead > 10
          ? `Ayın %${Math.round(monthProgress)}'indesin ama bütçenin %${Math.round(usageRate)}'ini harcadın — hız yüksek.`
          : ahead < -10
            ? `Ayın %${Math.round(monthProgress)}'indesin, bütçenin %${Math.round(usageRate)}'ini harcadın — planın önündesin.`
            : `Ayın %${Math.round(monthProgress)}'indesin, harcama %${Math.round(usageRate)} — plana uygun gidiyorsun.`,
    }
  }, [snapshotQuery.data, cardExpenses])

  const canManageBudgets = !missingTables.includes('budgets')
  const canManageGoals = !missingTables.includes('savings_goals')

  if (loading) {
    return <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Veriler yükleniyor...</p>
  }

  return (
    <section className="space-y-8">
      {/* Şerit (`4d`): kahraman "harcanan / limit" biçiminde ay bütçesi; bölen
          `ink-faint`, altında 4px çubuk ve hız yorumu. */}
      {budgetTotals ? (
        <div>
          <p className="uppercase text-ink-faint" style={{ fontSize: 12, letterSpacing: '0.1em', lineHeight: '16px' }}>
            Ay bütçesi
          </p>
          <p
            className="serit-num mt-2 text-[46px] font-semibold text-ink lg:text-[62px]"
            style={{ lineHeight: 0.95, letterSpacing: '-0.045em' }}
          >
            {seritAmount(budgetTotals.spent).amount}
            <span className="text-ink-faint">
              {' / '}
              {seritAmount(budgetTotals.limit).amount}
            </span>
            <span className="text-[19px] text-ink-faint lg:text-[23px]"> ₺</span>
          </p>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-track">
            <div
              className="h-full rounded-full transition-[width] duration-200 ease-out"
              style={{
                width: `${Math.min(100, budgetTotals.usageRate)}%`,
                background: SERIT_FILL[budgetTotals.tone],
              }}
            />
          </div>
          <p className="mt-2.5 text-[13px] text-ink-muted">{budgetTotals.pace}</p>
        </div>
      ) : null}

      {canManageGoals ? <SavingsGoalsPanel monthlySurplus={monthlySurplus} /> : null}

      <KasaModuPanel liquidCash={liquidCash} />

      {canManageBudgets ? (
        <CrudPage
          table="budgets"
          pageTitle="Bütçeler"
          pageLabel="Plan ve hedef"
          pageDescription="Kategori limitlerini ve birikim hedeflerini aylık ilerlemeyle birlikte yönet."
          addLabel="Bütçe ekle"
          fields={budgetFields}
          emptyTitle="Henüz bütçe yok"
          emptyDescription="Kategori bazlı aylık limit ekleyerek harcama takibini başlatabilirsin."
          orderBy="month"
          orderAscending={false}
          renderBeforeList={({ loading: crudLoading, rows }) =>
            !crudLoading ? <BudgetProgress budgets={rows as Budget[]} expenses={cardExpenses} /> : null
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
          renderDetails={(row) => [`Limit: ${formatAmount(row.limit_amount)}`]}
        />
      ) : null}
    </section>
  )
}
