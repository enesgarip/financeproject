import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import { fetchCrudRows } from '../data/repositories/crudRepo'
import type { CrudTableName, RowFor } from '../types/database'

/**
 * CrudPage listelerinin TanStack anahtarı. Sıralama parametreleri anahtarın
 * SONUNDA durur ki `crudRowsInvalidationKey` ile prefix-invalidate edilebilsin:
 * aynı tabloya farklı sıralamayla bakan (bugün yok, yarın olabilir) her sorgu
 * tek seferde tazelenir. userId anahtarda: çıkış/giriş değişiminde başka
 * kullanıcının satırları cache'ten sızmaz.
 */
export function crudRowsKey(table: CrudTableName, userId: string | undefined, orderBy: string, ascending: boolean) {
  return ['crud-rows', table, userId ?? 'anon', orderBy, ascending] as const
}

function crudRowsInvalidationKey(table: CrudTableName, userId: string | undefined) {
  return ['crud-rows', table, userId ?? 'anon'] as const
}

/** Bir tablonun tüm satırları, navigasyonlar arası cache'li (global staleTime/gcTime). */
export function useCrudRows<T extends CrudTableName>(table: T, orderBy: string, ascending: boolean) {
  const { user } = useAuth()

  return useQuery({
    queryKey: crudRowsKey(table, user?.id, orderBy, ascending),
    enabled: Boolean(user),
    queryFn: async (): Promise<RowFor<T>[]> => {
      const result = await fetchCrudRows(table, orderBy as never, ascending)
      if (!result.ok) throw new Error(result.error.message ?? 'Kayıtlar yüklenemedi.')
      return result.data
    },
  })
}

/**
 * Tabloya CrudPage DIŞINDAN yazan akışlar (ör. abonelik→plan, maaş şeridi) bu
 * fonksiyonla listeyi tazeler; dönen promise aktif sorguların refetch'i bitince
 * çözülür, yani `await` sonrası liste taze.
 */
export function useInvalidateCrudRows(table: CrudTableName) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id

  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: crudRowsInvalidationKey(table, userId) }),
    [queryClient, table, userId],
  )
}
