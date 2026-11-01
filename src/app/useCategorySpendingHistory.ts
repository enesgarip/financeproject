import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { fetchCategorySpendingHistory } from '../data/repositories/analysisRepo'

export function useCategorySpendingHistory() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['category-spending-history', user?.id],
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const result = await fetchCategorySpendingHistory()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  })
}
