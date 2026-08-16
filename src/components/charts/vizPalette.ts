/**
 * Grafik kategori renkleri — tek kaynak.
 *
 * Üç kural, üçü de daha önce ihlal ediliyordu:
 *
 *  1. **Durum rengi kimlik taşımaz.** success/warning/destructive yalnız
 *     başarı/uyarı/risk anlamındadır (UI_ARCHITECTURE görsel ilke 4). Kategori
 *     donut'unda "Ulaşım"ı kırmızı boyamak dilimi "kötü" gibi okutuyordu.
 *  2. **Renk varlığa bağlanır, sıralamaya değil.** Eskiden renk `dizi[i]` ile
 *     veri sırasından geliyordu; kategori sıralaması ay içinde değişince
 *     Market mavi'den turuncu'ya atlıyordu. Artık atama kanonik anahtar
 *     listesinden gelir, veriden değil.
 *  3. **Slot döngüye girmez.** `i % 8` dokuzuncu kategoriyi birinciyle aynı
 *     renge boyuyordu. Sekizden sonrası "artık kova"ya (nötr) düşer.
 *
 * Slot sırası CVD güvenliğinin mekanizmasıdır; token'lar `index.css`'te
 * doğrulanmış paletten gelir. Sırayı değiştirmeden önce paleti yeniden doğrula.
 */

/** Kimlik slotları — sabit sıra, asla döngüye sokulmaz. */
export const VIZ_SERIES = [
  'var(--viz-1)',
  'var(--viz-2)',
  'var(--viz-3)',
  'var(--viz-4)',
  'var(--viz-5)',
  'var(--viz-6)',
  'var(--viz-7)',
  'var(--viz-8)',
  // 9..13: harcama kategorileri 8'i aştığı için eklendi (Konut/Abonelik/İş/
  // Kişisel Bakım/Hediye). Token'lar index.css'te; 8'den sonrası CVD-ayırt
  // edilebilirliğin ucundadır, sırayı değiştirmeden önce paleti yeniden doğrula.
  'var(--viz-9)',
  'var(--viz-10)',
  'var(--viz-11)',
  'var(--viz-12)',
  'var(--viz-13)',
  // 14: Finansman. Diğer 13'ün hepsi doygun renk; 14 ayrı TONU renk körlüğünde
  // ayırt etmek mümkün olmadığı için bu slot kasıtlı olarak DÜŞÜK DOYGUNLUKTA
  // (slate) seçildi — tondan değil doygunluk/parlaklıktan ayrışır. Anlamca da
  // uygun: Finansman tüketim değil, paranın maliyeti.
  'var(--viz-14)',
] as const

/** Artık kova: kategori değil, o yüzden kasıtlı olarak nötr. */
export const VIZ_NEUTRAL = 'var(--viz-other)'

export type VizColorMap = Record<string, string>

/**
 * Kanonik anahtar listesinden sabit renk haritası üretir.
 *
 * `neutral` içindeki anahtarlar (ör. "Diğer") slot harcamaz; nötr renge düşer.
 * Slotlar bitince kalan anahtarlar da nötre düşer — böylece renk tekrar etmez.
 */
export function buildVizColorMap(
  canonicalKeys: readonly string[],
  neutral: readonly string[] = [],
): VizColorMap {
  const neutralSet = new Set(neutral)
  const map: VizColorMap = {}
  let slot = 0

  for (const key of canonicalKeys) {
    if (neutralSet.has(key)) {
      map[key] = VIZ_NEUTRAL
      continue
    }
    map[key] = slot < VIZ_SERIES.length ? VIZ_SERIES[slot++] : VIZ_NEUTRAL
  }

  return map
}

/** Haritada olmayan anahtar için nötr — bilinmeyen kategori slot çalmasın. */
export function vizColor(map: VizColorMap, key: string): string {
  return map[key] ?? VIZ_NEUTRAL
}

/**
 * Dilimleri kanonik sıraya dizer.
 *
 * Neden: paletin "komşu renkler ayırt edilebilir" garantisi YALNIZCA halka sırası
 * slot sırasıyla aynıyken geçerli. Dilimler tutara göre sıralanınca rastgele
 * renk çiftleri yan yana geliyordu — ölçüldü: Altın (aqua) ile Hisse (magenta)
 * deuteranopide ΔE 1.6, yani kırmızı-yeşil renk körü için neredeyse aynı renk.
 * Halka kanonik sırayı takip edince komşuluk = doğrulanmış slot komşuluğu olur.
 * Büyüklük sıralaması efsanede korunur; rakamlar zaten orada okunuyor.
 */
export function orderSlicesCanonically<T extends { name: string }>(
  slices: readonly T[],
  canonicalKeys: readonly string[],
): T[] {
  const rank = new Map(canonicalKeys.map((key, index) => [key, index]))
  const fallback = canonicalKeys.length
  return [...slices].sort(
    (a, b) => (rank.get(a.name) ?? fallback) - (rank.get(b.name) ?? fallback),
  )
}
