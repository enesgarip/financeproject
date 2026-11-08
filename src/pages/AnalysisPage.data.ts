import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { useAuth } from '../auth/useAuth'
import { fetchNetWorthSnapshots } from '../data/repositories/analysisRepo'
import { useMarketRates } from '../hooks/useMarketRates'
import {
  buildSearchItems,
  type AnalysisData,
} from '../utils/analysisView'
import { useResolvedSnapshotGoals } from '../app/useResolvedSnapshotGoals'

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

const STATEMENT_ARCHIVE_LIMIT = 48

// Bu sayfa artık yalnız OKUR. Günlük snapshot kaydı app/useDailyNetWorthSnapshot
// içinde Layout'a bağlıdır; böylece seri Analiz sayfası hiç açılmasa da dolar.
export function useAnalysisPageData() {
  const { user } = useAuth()
  const { snapshot: ratesSnapshot } = useMarketRates()

  const snapshotQuery = useFinanceSnapshot()
  const userId = user?.id
  const goals = useResolvedSnapshotGoals(snapshotQuery.data)

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
      savingsGoals: goals.goals,
    }
  }, [snapshotQuery.data, goals.goals])
  const missingTables = useMemo(
    () => (snapshotQuery.data?.missingTables ?? []),
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
      const result = await fetchNetWorthSnapshots()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  })


  const searchItems = useMemo(() => buildSearchItems(data), [data])

  return {
    data,
    goalsIncomplete: goals.incomplete,
    error: snapshotQuery.error instanceof Error ? snapshotQuery.error.message : '',
    loading: snapshotQuery.isPending,
    missingTables,
    auxiliaryLoading: netWorthQuery.isPending,
    auxiliaryError: netWorthQuery.isError,
    retryAuxiliary: () => netWorthQuery.refetch(),
    ratesSnapshot,
    searchItems,
    snapshots: netWorthQuery.data ?? [],
  }
}
