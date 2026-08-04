import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import { fetchContextExpenses, fetchExpenseContexts, fetchTaggedContextCardExpenses } from '../data/repositories/expenseContextsRepo'
import { buildExpenseContextSummaries } from '../utils/expenseContexts'

export const expenseContextsKey = (userId?: string) => ['expense-contexts', userId ?? 'anon'] as const

export function useExpenseContexts() {
  const { user } = useAuth()
  return useQuery({
    queryKey: expenseContextsKey(user?.id),
    enabled: Boolean(user),
    queryFn: async () => {
      const [contexts, manual, tagged] = await Promise.all([
        fetchExpenseContexts(), fetchContextExpenses(), fetchTaggedContextCardExpenses(),
      ])
      if (!contexts.ok) throw new Error(contexts.error.message)
      if (!manual.ok) throw new Error(manual.error.message)
      if (!tagged.ok) throw new Error(tagged.error.message)
      return {
        contexts: contexts.data,
        manualExpenses: manual.data,
        summaries: buildExpenseContextSummaries(contexts.data, manual.data, tagged.data),
      }
    },
  })
}

export function useInvalidateExpenseContexts() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: expenseContextsKey(user?.id) }),
    [queryClient, user?.id],
  )
}
