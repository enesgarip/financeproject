import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { fetchPriceRadarRows } from '../data/repositories/analysisRepo'
import { buildPriceObservations, detectPriceIncreases } from '../utils/priceIncreaseRadar'
import { useFinanceSnapshot } from './useFinanceSnapshot'

/** Ödeme yönetimi, Analiz'den taşınan fiyat geçmişini aynı kurallarla okur. */
export function usePriceTrends() {
  const { user } = useAuth()
  const snapshotQuery = useFinanceSnapshot()
  return useQuery({
    queryKey: ['price-trends', user?.id],
    enabled: Boolean(user && snapshotQuery.data),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const result = await fetchPriceRadarRows()
      if (!result.ok) throw new Error(result.error.message)
      return detectPriceIncreases(buildPriceObservations({
        transactionHistory: result.data.transactionHistory,
        payments: snapshotQuery.data?.payments ?? [],
        cardExpenses: result.data.cardExpenses,
      }))
    },
  })
}
