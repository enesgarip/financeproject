import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../auth/useAuth'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { fetchPriceRadarRows, upsertAndLoadNetWorthSnapshots } from '../data/repositories/analysisRepo'
import { CrudPage, type FormField } from '../components/CrudPage'
import type { Budget, NetWorthSnapshot } from '../types/database'
import { SavingsGoalsPanel } from '../components/finance/SavingsGoalsPanel'
import { expenseCategoryOptions } from '../utils/categories'
import { dateInputValue, startOfMonth } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { buildFinancialPosition } from '../utils/financeSummary'
import {
  buildSearchItems,
  formatMonth,
  type AnalysisData,
} from '../utils/analysisView'
import { useMarketRates } from '../hooks/useMarketRates'
import { type MarketRatesSnapshot } from '../utils/marketRates'
import { buildPriceObservations, detectPriceIncreases, type PriceTrend } from '../utils/priceIncreaseRadar'
import { MonthlyReport, SearchExport, StatementArchive } from './AnalysisPage.reports'
import { CashFlowTrend, ForwardForecast, NetWorthTrend } from './AnalysisPage.trends'
import { CategorySpendingChart, FireCalculator, InflationShieldPanel, ZakatPanel } from './AnalysisPage.wealth'
import {
  BudgetProgress,
  FinancialCalendar,
  MonthCloseAssistant,
  PeopleLedger,
  PriceIncreaseRadar,
  SchemaMigrationNotice,
  UpcomingInstallments,
} from './AnalysisPage.panels'

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

const STATEMENT_ARCHIVE_LIMIT = 48

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

async function loadNetWorthSnapshots(
  userId: string,
  loadedData: AnalysisData,
  ratesSnapshot: MarketRatesSnapshot | null,
): Promise<NetWorthSnapshot[] | null> {
  const position = buildFinancialPosition({
    assets: loadedData.assets,
    cards: loadedData.cards,
    loans: loadedData.loans,
    loanInstallments: loadedData.loanInstallments,
    debts: loadedData.debts,
    payments: loadedData.payments,
    salaryHistory: loadedData.salaryHistory,
    cardInstallments: loadedData.cardInstallments,
  })
  const result = await upsertAndLoadNetWorthSnapshots(userId, {
    netWorth: position.netWorth,
    goldTry: ratesSnapshot?.rates?.GRA?.buying ?? null,
    usdTry: ratesSnapshot?.rates?.USD?.buying ?? null,
  })

  return result.ok ? result.data : null
}

export function AnalysisPage() {
  const { user } = useAuth()
  const { snapshot: ratesSnapshot } = useMarketRates()
  const ratesSnapshotRef = useRef<MarketRatesSnapshot | null>(null)
  useEffect(() => { ratesSnapshotRef.current = ratesSnapshot }, [ratesSnapshot])

  const snapshotQuery = useFinanceSnapshot()
  const userId = user?.id

  const data: AnalysisData = useMemo(() => {
    const snapshot = snapshotQuery.data
    if (!snapshot) return emptyAnalysisData
    return {
      assets: snapshot.assets,
      cards: snapshot.cards,
      loans: snapshot.loans,
      loanInstallments: snapshot.loanInstallments,
      debts: snapshot.debts,
      payments: snapshot.payments,
      salaryHistory: snapshot.salaryHistory,
      transactionHistory: snapshot.transactionHistory,
      cardExpenses: snapshot.cardExpenses,
      cardInstallments: snapshot.cardInstallments.filter((installment) => installment.status !== 'paid'),
      cardStatementArchives: snapshot.cardStatements.slice(0, STATEMENT_ARCHIVE_LIMIT),
      budgets: snapshot.budgets,
      savingsGoals: snapshot.savingsGoals,
    }
  }, [snapshotQuery.data])
  const dataRef = useRef<AnalysisData>(emptyAnalysisData)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const loading = snapshotQuery.isPending
  const error = snapshotQuery.error instanceof Error ? snapshotQuery.error.message : ''
  const missingTables = useMemo(
    () => (snapshotQuery.data?.missingTables ?? []).filter((table) => table in optionalTableLabels),
    [snapshotQuery.data],
  )

  const netWorthQuery = useQuery({
    queryKey: ['net-worth-snapshots', userId, snapshotQuery.dataUpdatedAt],
    enabled: Boolean(userId && snapshotQuery.data),
    staleTime: Infinity,
    queryFn: async () => {
      try {
        return (await loadNetWorthSnapshots(userId as string, dataRef.current, ratesSnapshotRef.current)) ?? []
      } catch {
        return [] as NetWorthSnapshot[]
      }
    },
  })
  const snapshots = netWorthQuery.data ?? []

  const priceTrendsQuery = useQuery({
    queryKey: ['price-trends', userId, snapshotQuery.dataUpdatedAt],
    enabled: Boolean(userId && snapshotQuery.data),
    staleTime: Infinity,
    queryFn: async () => {
      try {
        const radarResult = await fetchPriceRadarRows()
        if (!radarResult.ok) return [] as PriceTrend[]

        const radar = radarResult.data
        const latestData = dataRef.current
        const observations = buildPriceObservations({
          transactionHistory: radar.transactionHistory,
          payments: latestData.payments,
          cardExpenses: radar.cardExpenses,
        })
        return detectPriceIncreases(observations)
      } catch {
        return [] as PriceTrend[]
      }
    },
  })
  const priceTrends = priceTrendsQuery.data ?? []

  const searchItems = useMemo(() => buildSearchItems(data), [data])
  const canManageBudgets = !missingTables.includes('budgets')
  const canManageGoals = !missingTables.includes('savings_goals')

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
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
        <PriceIncreaseRadar trends={priceTrends} />
        <CashFlowTrend data={data} />
        <NetWorthTrend snapshots={snapshots} ratesSnapshot={ratesSnapshot} />
        <InflationShieldPanel data={data} />
        <ZakatPanel data={data} ratesSnapshot={ratesSnapshot} />
        <ForwardForecast data={data} />
        <FireCalculator data={data} snapshots={snapshots} />
        <PeopleLedger debts={data.debts} />
        <SearchExport items={searchItems} />
        <StatementArchive data={data} />
      </div>

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Analiz verileri yükleniyor...</p> : null}

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

      {canManageGoals ? <SavingsGoalsPanel /> : null}
    </section>
  )
}
