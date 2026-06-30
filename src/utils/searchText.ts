/**
 * Arama/eşleştirme için metin normalleştirme. Filtreleme/eşleştirmede her zaman
 * bunu kullan; çıplak `toLocaleLowerCase('tr-TR')` KULLANMA.
 *
 * Neden: tr-TR locale'inde büyük "I" noktasız "ı"ya katlanır → "MIGROS"
 * aranınca "Migros" eşleşmez. Önce `[Iİ]→i` map'leyip sonra küçültüyoruz ki
 * Türkçe büyük harfli satıcı adları doğru eşleşsin (CLAUDE.md "tr-TR tuzağı").
 */
export function normalizeSearchText(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .replace(/[Iİ]/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
