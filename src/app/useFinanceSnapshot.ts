import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  fetchFinanceSnapshot,
  runFinanceMaintenance,
  type FinanceSnapshot,
} from '../data/repositories/financeSnapshotRepo'

export type { FinanceSnapshot }

const FINANCE_MAINTENANCE_THROTTLE_MS = 5 * 60 * 1000
let lastFinanceMaintenanceAt = 0
let financeMaintenancePromise: Promise<void> | null = null

export function financeSnapshotKey(userId: string | undefined) {
  return ['finance-snapshot', userId ?? 'anonymous'] as const
}

async function runFinanceMaintenanceForSnapshot() {
  if (Date.now() - lastFinanceMaintenanceAt < FINANCE_MAINTENANCE_THROTTLE_MS) return

  financeMaintenancePromise ??= runFinanceMaintenance()
    .then(() => {
      lastFinanceMaintenanceAt = Date.now()
    })
    .finally(() => {
      financeMaintenancePromise = null
    })

  await financeMaintenancePromise
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
      await runFinanceMaintenanceForSnapshot()
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
