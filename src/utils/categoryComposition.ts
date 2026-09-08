/**
 * Kategori dağılımı için "ilk N + kalanı Diğer" birleştirmesi.
 *
 * Halka/çubuk en fazla N dilim gösterir; eskiden fazlası sessizce ATILIYORDU ve
 * dilimlerin toplamı aylık raporun "Kart harcaması" rakamından küçük çıkıyordu
 * (UX turu 2026-09-08, B6). Şimdi kuyruk "Diğer" altında toplanır; gerçek bir
 * "Diğer" kategorisi varsa onunla birleşir. Toplam her zaman tam kalır.
 * Saf; Supabase görmez.
 */
import { sumTL } from './money'

export type CategoryTotal = { category: string; amount: number }

export const OTHER_CATEGORY = 'Diğer'

export function mergeCategoryTail(totals: CategoryTotal[], maxSlices: number): CategoryTotal[] {
  const sorted = [...totals].sort((a, b) => b.amount - a.amount)
  if (sorted.length <= maxSlices) return sorted

  const named = sorted.filter((item) => item.category !== OTHER_CATEGORY)
  const other = sorted.filter((item) => item.category === OTHER_CATEGORY)
  // "Diğer" bir slot yer; kalan slotlar en büyük adlandırılmış kalemlere.
  const keep = named.slice(0, Math.max(0, maxSlices - 1))
  const tail = named.slice(Math.max(0, maxSlices - 1))
  const otherAmount = sumTL([...other.map((item) => item.amount), ...tail.map((item) => item.amount)])

  return otherAmount > 0 ? [...keep, { category: OTHER_CATEGORY, amount: otherAmount }] : keep
}
