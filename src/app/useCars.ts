import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import { fetchCarExpenses, fetchCarReminders, fetchCars, fetchTaggedCardExpenses } from '../data/repositories/carsRepo'
import type { Car, CarExpense, CarReminder } from '../types/database'
import { buildCarSummaries, type CarSummary } from '../utils/carExpenses'

export const carsKey = (userId?: string) => ['cars', userId ?? 'anon'] as const

export type CarsData = {
  cars: Car[]
  manualExpenses: CarExpense[]
  reminders: CarReminder[]
  summaries: CarSummary[]
}

/** Arabalarım verisi: araçlar + kart-dışı manuel giderler + araca etiketli kart giderleri. */
export function useCars() {
  const { user } = useAuth()
  const userId = user?.id

  return useQuery({
    queryKey: carsKey(userId),
    enabled: Boolean(user),
    queryFn: async (): Promise<CarsData> => {
      const [carsRes, manualRes, taggedRes, remindersRes] = await Promise.all([
        fetchCars(),
        fetchCarExpenses(),
        fetchTaggedCardExpenses(),
        fetchCarReminders(),
      ])
      if (!carsRes.ok) throw new Error(carsRes.error.message)
      if (!manualRes.ok) throw new Error(manualRes.error.message)
      if (!taggedRes.ok) throw new Error(taggedRes.error.message)
      if (!remindersRes.ok) throw new Error(remindersRes.error.message)

      return {
        cars: carsRes.data,
        manualExpenses: manualRes.data,
        reminders: remindersRes.data,
        summaries: buildCarSummaries(carsRes.data, manualRes.data, taggedRes.data),
      }
    },
  })
}

/** Araç verisi yazan akışlar bunun döndürdüğü fonksiyonla cache'i tazeler. */
export function useInvalidateCars() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id

  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: carsKey(userId) }),
    [queryClient, userId],
  )
}
