import { QueryClient } from '@tanstack/react-query'

// Tek global cache: sayfalar aynı query key'i paylaştığında (örn. finance-snapshot)
// veri bir kez çekilir, navigasyonlar arası anında render edilir.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Pencere odağı/route değişiminde 30 sn'den taze veriyi yeniden çekme.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})
