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
import { resolveSavingsGoalRows } from '../utils/goalSources'
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
      // Kaynağa bağlı hedefin biriken tutarı DB'de değil burada oluşur; döküm
      // ve arama sonuçları ham 0'ı değil türetilmiş tutarı göstersin.
      savingsGoals: resolveSavingsGoalRows(
        snapshot.savingsGoals,
        snapshot.savingsGoalComponents,
        snapshot.savingsGoalSources,
        { assets: snapshot.assets, cards: snapshot.cards, snapshot: ratesSnapshot },
      ).goals,
    }
  }, [snapshotQuery.data, ratesSnapshot])
  const dataRef = useRef<AnalysisData>(emptyAnalysisData)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const missingTables = useMemo(
    () => (snapshotQuery.data?.missingTables ?? []).filter((table) => table in optionalTableLabels),
    [snapshotQuery.data],
  )

  // Anahtarda dataUpdatedAt TAŞIMA: her snapshot fetch'i (veri değişmese de)
  // yeni bir cache girdisi doğurur, staleTime fiilen ölür ve 1500 satıra kadar
  // geçmiş her pencere odağında sıfırdan iner. Günlük fotoğraf yazıcısı
  // (useDailyNetWorthSnapshot) zaten ['net-worth-snapshots'] prefix'ini
  // invalidate ediyor; gün içi tazelik için staleTime yeter.
  const netWorthQuery = useQuery({
    queryKey: ['net-worth-snapshots', userId],
    enabled: Boolean(userId && snapshotQuery.data),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      try {
        const result = await fetchNetWorthSnapshots()
        return (result.ok ? result.data : null) ?? []
      } catch {
        return [] as NetWorthSnapshot[]
      }
    },
  })

  // 13 aylık zam radarı trend analizi — mutation'ı dakikası dakikasına izlemesi
  // gerekmez; 10 dk'lık pencere yeterli tazelik verir (anahtar çöpü için üstteki not).
  const priceTrendsQuery = useQuery({
    queryKey: ['price-trends', userId],
    enabled: Boolean(userId && snapshotQuery.data),
    staleTime: 10 * 60_000,
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
