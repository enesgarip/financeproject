import { QueryClient } from '@tanstack/react-query'

// Tek global cache: sayfalar aynı query key'i paylaştığında (örn. finance-snapshot)
// veri bir kez çekilir, navigasyonlar arası anında render edilir.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Pencere odağı/route değişiminde 30 sn'den taze veriyi yeniden çekme.
      staleTime: 30_000,
      // Snapshot'ı okumayan sayfalarda gezinirken observer kalmıyor; varsayılan
      // 5 dk'lık gcTime cache'i siliyor ve Dashboard'a dönüş soğuk fetch +
      // tam skeleton oluyordu. Satırlar küçük, 30 dk bellekte tutmak ucuz.
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})
