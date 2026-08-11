import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  fetchFinanceSnapshot,
  runFinanceMaintenance,
  type FinanceSnapshot,
} from '../data/repositories/financeSnapshotRepo'

import { financeSnapshotKey } from './financeSnapshotKey'

export type { FinanceSnapshot }
export { financeSnapshotKey }

const FINANCE_MAINTENANCE_THROTTLE_MS = 5 * 60 * 1000
let lastFinanceMaintenanceAt = 0
let financeMaintenancePromise: Promise<boolean> | null = null

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
    // K2 (denetim 2026-08-12): girişten hemen sonra token henüz her istekte
    // geçerli olmayabiliyor (saat kayması/iat) ve ilk snapshot 401'lerle
    // düşüyordu; global retry:1 yetmeyip kullanıcıyı elle yenilemeye
    // zorluyordu. 3 deneme + üstel bekleme geçici auth hatasını kendi kendine
    // iyileştirir; kalıcı hata yine error state'e düşer.
    retry: 3,
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
