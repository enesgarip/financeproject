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
let financeMaintenancePromise: Promise<number> | null = null

/**
 * Bakımın değiştirdiği satır toplamını döndürür; throttle/hata = 0. Çoğu koşu
 * hiçbir satıra dokunmaz — o durumda snapshot'ı ikinci kez çekmek boşa 17 sorgudur,
 * invalidation yalnız gerçek değişiklikte yapılır.
 */
async function runFinanceMaintenanceInBackground(): Promise<number> {
  if (Date.now() - lastFinanceMaintenanceAt < FINANCE_MAINTENANCE_THROTTLE_MS) return 0

  financeMaintenancePromise ??= runFinanceMaintenance()
    .then((changedRows) => {
      lastFinanceMaintenanceAt = Date.now()
      return changedRows
    })
    .catch(() => 0)
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
      runFinanceMaintenanceInBackground().then((changedRows) => {
        if (changedRows > 0) queryClient.invalidateQueries({ queryKey: financeSnapshotKey(userId) })
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
