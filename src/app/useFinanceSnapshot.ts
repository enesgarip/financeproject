import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  fetchFinanceSnapshot,
  runFinanceMaintenance,
  type FinanceSnapshot,
} from '../data/repositories/financeSnapshotRepo'

export type { FinanceSnapshot }

export function financeSnapshotKey(userId: string | undefined) {
  return ['finance-snapshot', userId ?? 'anonymous'] as const
}

/**
 * Dashboard + Analiz'in ortak veri kaynağı. Aynı cache'i paylaşır: ilk giren
 * sayfa veriyi çeker, diğeri anında render eder. Pencere odağına dönüşte
 * TanStack Query bayat veriyi kendisi tazeler (eski manuel focus listener'larının yerine).
 */
export function useFinanceSnapshot() {
  const { user } = useAuth()

  return useQuery({
    queryKey: financeSnapshotKey(user?.id),
    enabled: Boolean(user),
    queryFn: async () => {
      await runFinanceMaintenance()
      return fetchFinanceSnapshot()
    },
  })
}

/** Para hareketi yazan akışlar bunun döndürdüğü fonksiyonla cache'i tazeler. */
export function useInvalidateFinanceSnapshot() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id

  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: financeSnapshotKey(userId) }),
    [queryClient, userId],
  )
}
