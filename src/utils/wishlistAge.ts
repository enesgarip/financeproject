/**
 * Bekleme kuralı (30 gün) rozetleri — tamamı MEVCUT kolonlardan türetilir,
 * hiçbir yeni veri yazılmaz. Klasik "30 gün bekle, hâlâ istiyorsan al"
 * kuralını sıfır ek girdiyle listeye gömer: liste zaten davranış verisi
 * biriktiriyordu (created_at/purchased_at), sadece göstermiyordu.
 *
 * created_at/purchased_at timestamptz'dir; gün farkı date-only dilimle
 * hesaplanır (`formatDate` date-only bekler — CLAUDE.md gotcha). Saat/dilim
 * kaymasının gün sınırını oynatmaması için iki taraf da yerel gün başına
 * indirgenir.
 */
import { startOfDay } from './date'

const DAY_IN_MS = 86_400_000

/** "Hâlâ istiyor musun?" eşiği — klasik 30 gün kuralı. */
export const WISHLIST_WAIT_DAYS = 30

export type WishlistAge = {
  /** Eklenmesinden bu yana geçen tam gün. */
  ageDays: number
  /** Bekleyen maddede ≥30 gün — "hâlâ istiyor musun?" durumu. */
  isStale: boolean
  /** Alınan maddede karar süresi (eklenme → alınma), gün; alınmamışsa null. */
  decisionDays: number | null
}

function dayValue(iso: string): number {
  return startOfDay(new Date(`${iso.slice(0, 10)}T00:00:00`)).getTime()
}

export function buildWishlistAge(
  item: { created_at: string; purchased_at: string | null; is_purchased: boolean },
  today: Date = new Date(),
): WishlistAge {
  const created = dayValue(item.created_at)
  const ageDays = Math.max(0, Math.round((startOfDay(today).getTime() - created) / DAY_IN_MS))
  const decisionDays =
    item.is_purchased && item.purchased_at
      ? Math.max(0, Math.round((dayValue(item.purchased_at) - created) / DAY_IN_MS))
      : null

  return {
    ageDays,
    isStale: !item.is_purchased && ageDays >= WISHLIST_WAIT_DAYS,
    decisionDays,
  }
}
