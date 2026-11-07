import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { fetchForeignCardSms } from '../data/repositories/foreignCardSmsRepo'

export function useForeignCardSms() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['foreign-card-sms', user?.id], enabled: !!user, staleTime: 60_000, queryFn: async () => {
    if (!user) throw new Error('Oturum bulunamadı.')
    const result = await fetchForeignCardSms(user.id)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  } })
}
