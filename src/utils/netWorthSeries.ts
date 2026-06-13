import type { NetWorthSnapshot } from '../types/database'

/**
 * Net değer trendi için zaman derinliği (roadmap Y7). Günlük snapshot'lar yıllar
 * içinde binlerce noktaya çıkar → uzun aralıklarda aylık agregasyon (ay sonu =
 * o ayın son snapshot'ı). 90 gün günlük kalır.
 */

export type NetWorthRange = '90d' | '1y' | 'all'

function ascByDate(a: NetWorthSnapshot, b: NetWorthSnapshot): number {
  return a.snapshot_date < b.snapshot_date ? -1 : a.snapshot_date > b.snapshot_date ? 1 : 0
}

/** N gün önceki tarihi YYYY-MM-DD verir. */
function isoDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Ayda bir nokta: her YYYY-AA için o ayın SON snapshot'ı (ay sonu net değer).
 * Sonuç ay sırasına göre artan.
 */
export function aggregateNetWorthByMonth(snapshots: NetWorthSnapshot[]): NetWorthSnapshot[] {
  const byMonth = new Map<string, NetWorthSnapshot>()
  for (const s of [...snapshots].sort(ascByDate)) {
    // Artan sırada gidildiği için aynı aya yazılan son değer = ay sonu;
    // insertion sırası (ilk gün) korunduğundan aylar artan kalır.
    byMonth.set(s.snapshot_date.slice(0, 7), s)
  }
  return [...byMonth.values()]
}

/**
 * Seçilen aralık için görüntülenecek seriyi üretir. 90g: günlük (ham);
 * 1y/Tümü: aylık agregasyon. Saf — `now` dışarıdan verilir.
 */
export function selectNetWorthSeries(
  snapshots: NetWorthSnapshot[],
  range: NetWorthRange,
  now: Date,
): { series: NetWorthSnapshot[]; aggregated: boolean } {
  const sorted = [...snapshots].sort(ascByDate)

  if (range === '90d') {
    const cutoff = isoDaysAgo(now, 90)
    return { series: sorted.filter((s) => s.snapshot_date >= cutoff), aggregated: false }
  }
  if (range === '1y') {
    const cutoff = isoDaysAgo(now, 365)
    return { series: aggregateNetWorthByMonth(sorted.filter((s) => s.snapshot_date >= cutoff)), aggregated: true }
  }
  return { series: aggregateNetWorthByMonth(sorted), aggregated: true }
}
