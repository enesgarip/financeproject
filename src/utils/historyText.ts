/**
 * İşlem geçmişi metinlerini Türkçe karaktere kavuşturur.
 *
 * SQL fonksiyonları `transaction_history` başlık/notlarını ASCII yazar ("odendi",
 * "hesabindan", "Pesin kart harcamasi") — encoding tuzaklarından kaçınmak için
 * bilinçli. Kullanıcıya gösterirken bu sözlükle tam-kelime eşleşmesiyle
 * dönüştürülür (UX turu 2026-09-08, B16). Arama normalizasyonu (`searchText`)
 * iki biçimi de eşlediği için filtreleme etkilenmez. Saf; Supabase görmez.
 */
const WORDS: Record<string, string> = {
  odendi: 'ödendi',
  odenmedi: 'ödenmedi',
  odeme: 'ödeme',
  Odeme: 'Ödeme',
  odemesi: 'ödemesi',
  islendi: 'işlendi',
  olusturuldu: 'oluşturuldu',
  hesabindan: 'hesabından',
  hesabina: 'hesabına',
  hesaplar: 'hesaplar',
  arasi: 'arası',
  aktarildi: 'aktarıldı',
  Pesin: 'Peşin',
  pesin: 'peşin',
  harcamasi: 'harcaması',
  kartina: 'kartına',
  kartindan: 'kartından',
  kesinlesti: 'kesinleşti',
  donem: 'dönem',
  icine: 'içine',
  gunu: 'günü',
  gun: 'gün',
  tahsilat: 'tahsilat',
  kaydi: 'kaydı',
  kaydindan: 'kaydından',
  taksitli: 'taksitli',
  iptal: 'iptal',
  duzeltme: 'düzeltme',
  Duzeltme: 'Düzeltme',
  degisimi: 'değişimi',
  Degisimi: 'Değişimi',
  bulunamadi: 'bulunamadı',
  Vade: 'Vade',
}

const WORD_PATTERN = /[A-Za-z]+/g

export function turkishizeHistoryText(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(WORD_PATTERN, (word) => WORDS[word] ?? word)
}
