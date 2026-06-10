import { describe, expect, it } from 'vitest'
import { inferExpenseCategory } from './categories'

/**
 * Golden regression set for keyword categorisation.
 *
 * Each row is a real-world (or realistic) expense description and the category
 * it MUST resolve to — or `null` when it must NOT be auto-categorised at all.
 * This is the single place to grow when a misclassification is found: add the
 * exact description that went wrong with the category it should have produced,
 * and it can never silently regress again.
 *
 *   👉 Yeni bir yanlış eşleşme gördüğünde: o açıklamayı doğru kategorisiyle
 *      (ya da otomatik atanmaması gerekiyorsa `null`) aşağıya bir satır ekle.
 */
const CATEGORY_CASES: Array<{ description: string; expected: string | null }> = [
  // --- Market ---
  { description: 'MIGROS 3M ATASEHIR', expected: 'Market' },
  { description: 'A101 4567 KADIKOY', expected: 'Market' },
  { description: 'BIM BIRLESIK MAGAZALAR', expected: 'Market' },
  { description: 'ŞOK MARKET', expected: 'Market' },
  { description: 'CarrefourSA', expected: 'Market' },
  { description: 'Kasap Mehmet', expected: 'Market' },

  // --- Yemek ---
  { description: 'YEMEKSEPETI ISTANBUL', expected: 'Yemek' },
  { description: 'Starbucks Coffee', expected: 'Yemek' },
  { description: "Domino's Pizza", expected: 'Yemek' },
  { description: 'CITY DONER KEBAP', expected: 'Yemek' },
  { description: 'Cafe Nero', expected: 'Yemek' },

  // --- Ulaşım ---
  { description: 'SHELL PETROL', expected: 'Ulaşım' },
  { description: 'BP AKARYAKIT', expected: 'Ulaşım' },
  { description: 'OPET AKARYAKIT', expected: 'Ulaşım' },
  { description: 'Taksi durağı ödemesi', expected: 'Ulaşım' },
  { description: 'UBER TRIP', expected: 'Ulaşım' },
  { description: 'MARMARAY GECIS', expected: 'Ulaşım' },

  // --- Fatura ---
  { description: 'TURKCELL FATURA', expected: 'Fatura' },
  { description: 'Vodafone Otomatik Ödeme', expected: 'Fatura' },
  { description: 'IGDAS DOGALGAZ', expected: 'Fatura' },
  { description: 'Superonline Internet', expected: 'Fatura' },

  // --- Sağlık ---
  { description: 'ECZANE SIFA', expected: 'Sağlık' },
  { description: 'Acibadem Hastane', expected: 'Sağlık' },
  { description: 'Dis Hekimi Kontrol', expected: 'Sağlık' },

  // --- Eğitim ---
  { description: 'UDEMY COURSE', expected: 'Eğitim' },
  { description: 'Kirtasiye Defter Kalem', expected: 'Eğitim' },

  // --- Eğlence ---
  { description: 'NETFLIX.COM', expected: 'Eğlence' },
  { description: 'Spotify Premium', expected: 'Eğlence' },
  { description: 'Cinemaximum Sinema', expected: 'Eğlence' },

  // --- Alışveriş ---
  { description: 'TRENDYOL SIPARIS', expected: 'Alışveriş' },
  { description: 'HEPSIBURADA', expected: 'Alışveriş' },
  { description: 'Zara Store', expected: 'Alışveriş' },
  { description: 'Teknosa Telefon', expected: 'Alışveriş' },

  // --- Footguns: short keywords must NOT latch onto larger words ---
  // "taksi" inside "taksit" → instalment rows must NOT become Ulaşım (real bug).
  { description: 'BEYLER OPTİK Peş. Taksit 1.Tk Anapara', expected: null },
  { description: 'NEOVA SİGORTA Peş. Taksit 3.Tk Anapara', expected: null },
  { description: 'Taksitli İşlem', expected: null },
  // "bp" must not match inside another token.
  { description: 'ABPLAST SANAYI', expected: null },
  // "dis" (diş) must not match "disko".
  { description: 'DISKO GECESI', expected: null },
  // "su" type short words shouldn't run wild; an unrelated merchant stays null.
  { description: 'KUYUMCU ALTIN', expected: null },
]

describe('categorisation golden set', () => {
  it.each(CATEGORY_CASES)('"$description" → $expected', ({ description, expected }) => {
    expect(inferExpenseCategory(description)).toBe(expected)
  })

  it('covers every expense category at least once (except Diğer)', () => {
    const covered = new Set(CATEGORY_CASES.map((c) => c.expected).filter((c): c is string => c != null))
    for (const category of ['Market', 'Yemek', 'Ulaşım', 'Fatura', 'Sağlık', 'Eğitim', 'Eğlence', 'Alışveriş']) {
      expect(covered.has(category)).toBe(true)
    }
  })
})
