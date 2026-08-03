/**
 * İçe aktarma (ekstre + güncel hareket) mutabakatında SMS provizyonu ile banka
 * kaydını aynı sayan eşleşme kuralları. İki parser (denizBankMovementParser,
 * denizBankStatementParser) TEK kaynaktan tuning alsın diye buradadır — birini
 * gevşetip diğerini unutmak mükerrer kayıt üretir.
 *
 * Neden gevşetildi: SMS provizyonu harcama anını, banka kaydı ise birkaç iş günü
 * sonrasını taşır; küçük tutar sapması (döviz/bahşiş) olabilir. Fazla dar pencere
 * aynı işlemi ikinci kez yazdırır. Fazla geniş pencere ise iki farklı işlemi
 * yanlışlıkla birleştirir → uzak pencerede açıklama uyumu ZORUNLU tutulur.
 */
import { diffTL, greaterThanTL, roundTL } from './money'
import { normalizeSearchText } from './searchText'

/** Aynı gün + birkaç gün içi: tek aday ise açıklama körüyle bile güvenli sayılır. */
export const NEAR_DATE_MATCH_WINDOW_DAYS = 3
/** Genişletilmiş üst sınır: bu pencerede eşleşme yalnız açıklama uyumluysa geçerli. */
export const LOOSE_DATE_MATCH_WINDOW_DAYS = 7

const BASE_AMOUNT_TOLERANCE_TL = 5
const RELATIVE_AMOUNT_TOLERANCE = 0.01

/** İki tutarın eşleşme toleransı (TL): büyük işlemde %1, küçükte taban 5 TL baskın. */
export function importAmountTolerance(a: number, b: number): number {
  return Math.max(
    BASE_AMOUNT_TOLERANCE_TL,
    roundTL(Math.max(Math.abs(a), Math.abs(b)) * RELATIVE_AMOUNT_TOLERANCE),
  )
}

/** a ve b eşleşme toleransı içinde mi (kuruş hassasiyetli, sınır dahil). */
export function amountsMatchForImport(a: number, b: number): boolean {
  return !greaterThanTL(Math.abs(diffTL(a, b)), importAmountTolerance(a, b))
}

/** İki açıklamanın aynı işleme ait olacak kadar örtüşüp örtüşmediği. */
export function descriptionsCompatibleForImport(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftKey = descriptionKey(left)
  const rightKey = descriptionKey(right)
  // Taraflardan biri boşsa reddedecek bilgi yok → uyumlu say (eski davranış).
  if (!leftKey || !rightKey) return true
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true

  const leftTokens = new Set(leftKey.split(' ').filter((token) => token.length >= 3))
  const rightTokens = rightKey.split(' ').filter((token) => token.length >= 3)
  const common = rightTokens.filter((token) => leftTokens.has(token)).length
  return common >= Math.min(2, rightTokens.length)
}

function descriptionKey(value: string | null | undefined): string {
  return normalizeSearchText(value ?? '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export type ImportMatchCandidate = {
  index: number
  /** Aday ile banka kaydının gün cinsinden mesafesi (>= 0). */
  distance: number
  descriptionCompatible: boolean
}

/**
 * Aynı tutarlı adaylar arasından güvenli eşleşmeyi seçer. Sıra:
 * 1. Aynı gün + açıklama uyumlu
 * 2. Aynı gün + tek aday (açıklama körü — aynı tutar aynı gün ~ aynı işlem)
 * 3. Yakın pencere (<= NEAR) + açıklama uyumlu (en yakın gün önce)
 * 4. Yakın pencere + tek aday (açıklama körü)
 * 5. Uzak pencere (NEAR..LOOSE) + açıklama uyumlu — körlemesine eşleşme YOK
 *
 * Belirsiz durumda (iki aynı-gün aynı-tutar, açıklama uyumsuz) eşleştirmez;
 * iki farklı işlemi rastgele birleştirmek mükerrerden daha kötüdür.
 */
export function selectImportMatchIndex(candidates: readonly ImportMatchCandidate[]): number | undefined {
  const exact = candidates.filter((candidate) => candidate.distance === 0)
  const near = candidates.filter(
    (candidate) => candidate.distance > 0 && candidate.distance <= NEAR_DATE_MATCH_WINDOW_DAYS,
  )
  const far = candidates.filter(
    (candidate) =>
      candidate.distance > NEAR_DATE_MATCH_WINDOW_DAYS && candidate.distance <= LOOSE_DATE_MATCH_WINDOW_DAYS,
  )

  const byDistance = (a: ImportMatchCandidate, b: ImportMatchCandidate) => a.distance - b.distance

  const exactPreferred = exact.find((candidate) => candidate.descriptionCompatible)?.index
  const exactFallback = exact.length === 1 ? exact[0]!.index : undefined
  const nearPreferred = [...near].sort(byDistance).find((candidate) => candidate.descriptionCompatible)?.index
  const nearFallback = near.length === 1 ? near[0]!.index : undefined
  const farPreferred = [...far].sort(byDistance).find((candidate) => candidate.descriptionCompatible)?.index

  return exactPreferred ?? exactFallback ?? nearPreferred ?? nearFallback ?? farPreferred
}
