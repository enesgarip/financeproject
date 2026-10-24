import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  fetchFinanceSnapshot,
  runFinanceMaintenance,
  type FinanceSnapshot,
} from '../data/repositories/financeSnapshotRepo'

import { financeSnapshotKey } from './financeSnapshotKey'
import { cardPageDataKey } from './cardPageDataKey'
import { crudRowsInvalidationKey } from './useCrudRows'

export type { FinanceSnapshot }
export { financeSnapshotKey }

const FINANCE_MAINTENANCE_THROTTLE_MS = 5 * 60 * 1000
let lastFinanceMaintenanceAt = 0
let financeMaintenancePromise: Promise<number> | null = null

// RPC'ler birden çok tabloyu değiştirir. Snapshot ve sayfa listeleri aynı
// yazmadan sonra tazelenmeli; kapalı listeler bir sonraki açılışta okunur.
const FINANCE_CRUD_TABLES = ['cards', 'payments', 'loans', 'debts', 'assets', 'stock_trades'] as const

async function invalidateFinanceViews(queryClient: QueryClient, userId: string | undefined) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: financeSnapshotKey(userId) }),
    queryClient.invalidateQueries({ queryKey: cardPageDataKey(userId) }),
    queryClient.invalidateQueries({ queryKey: ['account-ledger-recent', userId] }),
    queryClient.invalidateQueries({ queryKey: ['card-expense-pace', userId] }),
    ...FINANCE_CRUD_TABLES.map((table) => queryClient.invalidateQueries({ queryKey: crudRowsInvalidationKey(table, userId) })),
  ])
}

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
        if (changedRows > 0) {
          void invalidateFinanceViews(queryClient, userId)
        }
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
    () => invalidateFinanceViews(queryClient, userId),
    [queryClient, userId],
  )
}
