/**
 * Alışveriş listesi satırlarının paylaşılan TanStack sorgusu + anahtar sabiti.
 *
 * Anahtar WishlistPage içinde sayfa-lokal bir const'tu; Karar–Liste köprüsü
 * (PurchaseDecisionPage'in "Şimdilik listeye at" yazısı) invalidate etmek için
 * string kopyalamak zorunda kalacaktı — sessiz bayatlama üretirdi (CLAUDE.md'nin
 * "dışarıdan yazan invalidate etmeli" dersi; KASA_BUCKETS_QUERY_KEY emsali).
 */
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { fetchWishlistItems } from '../data/repositories/wishlistRepo'

export const WISHLIST_QUERY_KEY = ['wishlist-items'] as const

export function useWishlistItems() {
  const { user } = useAuth()
  return useQuery({
    // userId anahtarda + enabled: auth çözülmeden ateşleyip boş/401 dönmesin;
    // invalidate WISHLIST_QUERY_KEY prefix'iyle yapıldığı için davranış değişmez.
    queryKey: [...WISHLIST_QUERY_KEY, user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const result = await fetchWishlistItems()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  })
}
