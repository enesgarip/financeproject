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
let financeMaintenancePromise: Promise<boolean> | null = null

export function financeSnapshotKey(userId: string | undefined) {
  return ['finance-snapshot', userId ?? 'anonymous'] as const
}

/** Returns true if maintenance actually ran, false if throttled/skipped. */
async function runFinanceMaintenanceInBackground(): Promise<boolean> {
  if (Date.now() - lastFinanceMaintenanceAt < FINANCE_MAINTENANCE_THROTTLE_MS) return false

  financeMaintenancePromise ??= runFinanceMaintenance()
    .then(() => {
      lastFinanceMaintenanceAt = Date.now()
      return true
    })
    .catch(() => false)
    .finally(() => {
      financeMaintenancePromise = null
    })

  return financeMaintenancePromise
}

export function useFinanceSnapshot() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id

  return useQuery({
    queryKey: financeSnapshotKey(userId),
    enabled: Boolean(user),
    queryFn: async () => {
      const snapshotPromise = fetchFinanceSnapshot()
      runFinanceMaintenanceInBackground().then((didRun) => {
        if (didRun) queryClient.invalidateQueries({ queryKey: financeSnapshotKey(userId) })
      })
      return snapshotPromise
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
