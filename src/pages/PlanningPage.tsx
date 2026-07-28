import { useMemo } from 'react'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { CrudPage, type FormField } from '../components/CrudPage'
import { SavingsGoalsPanel } from '../components/finance/SavingsGoalsPanel'
import type { Budget } from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { dateInputValue, startOfMonth } from '../utils/date'
import { parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { formatMonth } from '../utils/analysisView'
import { buildFinancialPosition, buildMonthlyCashFlow } from '../utils/financeSummary'
import { buildSafeToSpend, DEFAULT_BUFFER } from '../utils/safeToSpend'
import { BudgetProgress } from './AnalysisPage.panels'

// SafeToSpendCard ile aynı localStorage anahtarı (tampon kullanıcı tercihi, cihaza özel).
const BUFFER_KEY = 'denge:safe-to-spend-buffer'

function readSafeToSpendBuffer() {
  try {
    const raw = localStorage.getItem(BUFFER_KEY)
    const parsed = raw != null ? Number(raw) : Number.NaN
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BUFFER
  } catch {
    return DEFAULT_BUFFER
  }
}

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
  const loading = snapshotQuery.isPending

  const missingTables = useMemo(
    () => snapshotQuery.data?.missingTables ?? [],
    [snapshotQuery.data],
  )

  const cardExpenses = useMemo(
    () => snapshotQuery.data?.cardExpenses ?? [],
    [snapshotQuery.data],
  )

  // Bu ayki harcanabilir (safeToSpend) — birikim önerisine "bu ay ayır / ara ver"
  // bağlamı verir. Dashboard SafeToSpendCard ile aynı hesap.
  const monthlySurplus = useMemo(() => {
    const data = snapshotQuery.data
    if (!data) return undefined
    const position = buildFinancialPosition(data)
    const cashFlow = buildMonthlyCashFlow(data)
    return buildSafeToSpend({
      liquidCash: position.totalCashAssets,
      expectedIncome: cashFlow.expectedIncome,
      remainingOutflow: cashFlow.remainingOutflow,
      buffer: readSafeToSpendBuffer(),
    }).amount
  }, [snapshotQuery.data])

  const canManageBudgets = !missingTables.includes('budgets')
  const canManageGoals = !missingTables.includes('savings_goals')

  if (loading) {
    return <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Veriler yükleniyor...</p>
  }

  return (
    <section className="space-y-8">
      {canManageGoals ? <SavingsGoalsPanel monthlySurplus={monthlySurplus} /> : null}

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
