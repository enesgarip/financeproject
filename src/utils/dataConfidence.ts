/**
 * Rakamın ne kadar güvenilir olduğunun TEK dili.
 *
 * Uygulama her sayıyı aynı kesinlikte gösteriyordu: banka bakiyesi de,
 * "yaklaşık ₺527" fatura tahmini de, 44 gündür doğrulanmamış kart borcu da
 * ₺1.234,56 diye yazılıyordu. Kullanıcı hangi rakama güveneceğini bilemiyordu.
 *
 * Üç seviye yeter:
 *  - exact    : doğrulanmış/kesin — rozet gösterilmez (gürültü olmasın)
 *  - estimate : tutar tahmini (fatura tahmini, otomatik değerleme, legacy kredi)
 *  - stale    : değer kesin ama DOĞRULANMAYALI çok olmuş (mutabakat/kur yaşı)
 *
 * Saf; UI karşılığı `components/ui/confidence-badge.tsx`.
 */

export type ConfidenceLevel = 'exact' | 'estimate' | 'stale'

export type Confidence = {
  level: ConfidenceLevel
  /** Rozet metni; exact seviyede boş. */
  label: string
  /** Tooltip/açıklama — neden bu seviyede olduğunu söyler. */
  reason: string
}

export const EXACT: Confidence = { level: 'exact', label: '', reason: 'Doğrulanmış tutar.' }

export function estimateConfidence(reason = 'Bu tutar tahmindir; kesinleşince güncellenir.'): Confidence {
  return { level: 'estimate', label: 'Tahmini', reason }
}

/**
 * Gün cinsinden yaşa göre bayatlık. `staleAfterDays` eşiğini geçmediyse exact.
 * Hiç doğrulanmamışsa (null) doğrudan bayat sayılır — "bilmiyoruz" da bir risktir.
 */
export function freshnessConfidence(
  daysSinceVerified: number | null,
  staleAfterDays: number,
  subject = 'Bu rakam',
): Confidence {
  if (daysSinceVerified === null) {
    return {
      level: 'stale',
      label: 'Doğrulanmadı',
      reason: `${subject} bankayla hiç karşılaştırılmadı.`,
    }
  }
  if (daysSinceVerified > staleAfterDays) {
    return {
      level: 'stale',
      label: `${daysSinceVerified} gün önce`,
      reason: `${subject} ${daysSinceVerified} gündür bankayla karşılaştırılmadı; arada kaçan işlem olabilir.`,
    }
  }
  return EXACT
}

/**
 * Otomatik değerlenen bir satırın güveni (Faz D3).
 *
 * `source='stored'` = otomatik değerleme açık ama canlı kur alınamadı, ekranda
 * en son saklanan tutar duruyor. Bu sessiz kaldığı sürece kullanıcı bayat bir
 * rakamı canlı sanıyordu; rozet "ne kadar bayat" sorusunu da cevaplar.
 * `valuedAt` bilinmiyorsa (kolondan önceki kayıt) yaş yerine bunu söyler.
 */
export function valuationConfidence(
  source: 'live' | 'stored' | 'manual',
  valuedAt: string | null,
  now: Date = new Date(),
): Confidence {
  if (source !== 'stored') return EXACT
  if (!valuedAt) {
    return {
      level: 'stale',
      label: 'Kur yok',
      reason: 'Canlı kur alınamadı; saklanan tutar gösteriliyor ve ne zaman hesaplandığı bilinmiyor.',
    }
  }
  const days = Math.floor((now.getTime() - new Date(valuedAt).getTime()) / 86_400_000)
  if (!Number.isFinite(days)) {
    return { level: 'stale', label: 'Kur yok', reason: 'Canlı kur alınamadı; saklanan tutar gösteriliyor.' }
  }
  return {
    level: 'stale',
    label: days <= 0 ? 'Kur yok' : `${days} gün önceki kur`,
    reason:
      days <= 0
        ? 'Canlı kur alınamadı; bugün hesaplanan son tutar gösteriliyor.'
        : `Canlı kur alınamadı; ${days} gün önceki kurla hesaplanmış tutar gösteriliyor.`,
  }
}

/** Birden çok sinyal varsa en kötüsü kazanır (stale > estimate > exact). */
export function worstConfidence(...values: Confidence[]): Confidence {
  const rank: Record<ConfidenceLevel, number> = { exact: 0, estimate: 1, stale: 2 }
  return values.reduce((worst, current) => (rank[current.level] > rank[worst.level] ? current : worst), EXACT)
}
