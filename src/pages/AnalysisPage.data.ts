import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { useAuth } from '../auth/useAuth'
import { fetchNetWorthSnapshots, fetchPriceRadarRows } from '../data/repositories/analysisRepo'
import { useMarketRates } from '../hooks/useMarketRates'
import type { NetWorthSnapshot } from '../types/database'
import {
  buildSearchItems,
  type AnalysisData,
} from '../utils/analysisView'
import { type MarketRatesSnapshot } from '../utils/marketRates'
import { buildPriceObservations, detectPriceIncreases, type PriceTrend } from '../utils/priceIncreaseRadar'

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
}

const STATEMENT_ARCHIVE_LIMIT = 48

// Bu sayfa artık yalnız OKUR. Günlük snapshot kaydı app/useDailyNetWorthSnapshot
// içinde Layout'a bağlıdır; böylece seri Analiz sayfası hiç açılmasa da dolar.
export function useAnalysisPageData() {
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
      cardStatementPayments: snapshot.cardStatementPayments,
      budgets: snapshot.budgets,
      savingsGoals: snapshot.savingsGoals,
    }
  }, [snapshotQuery.data])
  const dataRef = useRef<AnalysisData>(emptyAnalysisData)
  useEffect(() => {
    dataRef.current = data
  }, [data])

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
        const result = await fetchNetWorthSnapshots()
        return (result.ok ? result.data : null) ?? []
      } catch {
        return [] as NetWorthSnapshot[]
      }
    },
  })

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

  const searchItems = useMemo(() => buildSearchItems(data), [data])

  return {
    data,
    error: snapshotQuery.error instanceof Error ? snapshotQuery.error.message : '',
    loading: snapshotQuery.isPending,
    missingTables,
    priceTrends: priceTrendsQuery.data ?? [],
    ratesSnapshot,
    searchItems,
    snapshots: netWorthQuery.data ?? [],
  }
}
