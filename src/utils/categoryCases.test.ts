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

  // --- Yeme & İçme ---
  { description: 'YEMEKSEPETI ISTANBUL', expected: 'Yeme & İçme' },
  { description: 'Starbucks Coffee', expected: 'Yeme & İçme' },
  { description: "Domino's Pizza", expected: 'Yeme & İçme' },
  { description: 'CITY DONER KEBAP', expected: 'Yeme & İçme' },
  { description: 'Cafe Nero', expected: 'Yeme & İçme' },
  // Gerçek DenizBank ekstre satırları (2026-08). Hepsi ESKİDEN Diğer'e
  // düşüyordu: Türkçe 'kafe', çıplak 'coffee' ve bankanın Starbucks için
  // bastığı 'SBUX'/'SBX' kısaltmaları sözlükte yoktu.
  { description: 'PETROV KAFE BURSA TR', expected: 'Yeme & İçme' },
  { description: 'COFFEE SINKY BURSA TR', expected: 'Yeme & İçme' },
  { description: 'SBUX IST FIKIRTEPE YENITE', expected: 'Yeme & İçme' },
  { description: 'SBX İZM KORDON İZMİR TR', expected: 'Yeme & İçme' },
  { description: 'GLORIA JEANS MARKA AVM BURSA TR', expected: 'Yeme & İçme' },
  { description: 'KOFTECI YUSUF AS BRS KARA BURSA TUR', expected: 'Yeme & İçme' },
  { description: 'GREEN SALATA BURSA TR', expected: 'Yeme & İçme' },

  // --- Finansman (paranın maliyeti; tüketim değil) ---
  { description: 'NAKİT AVANS ANAPARA', expected: 'Finansman' },
  { description: 'TAKSİTLİ NAKİT AVANS', expected: 'Finansman' },
  { description: 'Nakit Avans Faizi', expected: 'Finansman' },
  { description: 'BSMV', expected: 'Finansman' },
  { description: 'KKDF', expected: 'Finansman' },
  { description: 'GECİKME FAİZİ', expected: 'Finansman' },
  // "kart aidatı" Finansman, "apartman aidatı" Konut — Finansman kuralı sırada
  // önce ama yalnız "kart aidatı" ifadesiyle eşleşir.
  { description: 'KART AİDATI', expected: 'Finansman' },
  { description: 'APARTMAN AİDATI', expected: 'Konut' },

  // --- Aksan katlama + çekimli biçim regresyonları (2026-08-16) ---
  // Hepsi ESKİDEN Diğer'e düşüyordu; ölçüm 69 satırın 43'ünü Diğer'de buluyordu.
  { description: 'İREM ECZANESİ ÇANAKKALE TR', expected: 'Sağlık' },       // 'eczane' çekimli biçimi tutmuyordu
  { description: 'KARYA DOĞA VETERİNER BURSA TR', expected: 'Sağlık' },
  { description: 'AKUĞUR ALIŞVERİŞ MERKEZİ BURSA TR', expected: 'Alışveriş' }, // ALL-CAPS hibrit normalizasyon
  { description: 'ÖZTRAKYA AKARYAKIT İZMİR TR', expected: 'Ulaşım' },      // 'yakıt' AKARYAKIT'ı tutmuyordu
  { description: '16NHY76 HGS yükl. bedeli İSTANBUL TR', expected: 'Ulaşım' },
  { description: 'AÇIK ALAN OTOPARKLAR İZMİR TR', expected: 'Ulaşım' },    // 'otopark' çoğulu tutmuyordu
  { description: 'DOUBLETREE BY HİLTON İZMİR TR', expected: 'Ulaşım' },    // ekstredeki "SEYAHAT & ULAŞIM" ile tutarlı
  { description: 'BUSKİ - BURSA SU 498149 ö', expected: 'Fatura' },
  { description: 'APPLE.COM/BILL CORK IRL', expected: 'Abonelik' },
  { description: 'GOOGLE *YouTube', expected: 'Abonelik' },
  { description: 'IYZICO /AMAZONPRİMET İSTANBUL TR', expected: 'Abonelik' },
  { description: 'FS *SUPERCELLSTORE fsprg nl NLD', expected: 'Eğlence' },
  // 'youtube' Abonelik'te ama 'google' EKLENMEDİ: reklam harcaması İş kalmalı.
  { description: 'GOOGLE ADS', expected: 'İş' },

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

  // --- Konut ---
  { description: 'Ev Kira Odemesi', expected: 'Konut' },
  { description: 'SITE AIDAT AGUSTOS', expected: 'Konut' },

  // --- Abonelik ---
  { description: 'ICLOUD STORAGE', expected: 'Abonelik' },
  { description: 'BluTV Abonelik', expected: 'Abonelik' },

  // --- İş ---
  { description: 'GOOGLE ADS REKLAM', expected: 'İş' },
  { description: 'Natro Hosting Yenileme', expected: 'İş' },

  // --- Kişisel Bakım ---
  { description: 'KUAFOR SALON', expected: 'Kişisel Bakım' },
  { description: 'GRATIS KADIKOY', expected: 'Kişisel Bakım' },

  // --- Hediye ---
  { description: 'Ciceksepeti Hediye', expected: 'Hediye' },
  { description: 'KIZILAY BAGIS', expected: 'Hediye' },

  // --- Footguns: short keywords must NOT latch onto larger words ---
  // "taksi" inside "taksit" → instalment rows must NOT become Ulaşım (real bug).
  // Bu satır 2026-08-16'da null → 'Sağlık' oldu ('optik' anahtarı eklendi,
  // optisyen gerçekten Sağlık). Footgun iddiası KORUNUYOR ve hatta güçlendi:
  // taksit metni satırı Ulaşım'a çekmiyor, gerçek anahtar kazanıyor.
  { description: 'BEYLER OPTİK Peş. Taksit 1.Tk Anapara', expected: 'Sağlık' },
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
    for (const category of ['Market', 'Yeme & İçme', 'Ulaşım', 'Fatura', 'Sağlık', 'Eğitim', 'Eğlence', 'Alışveriş', 'Konut', 'Abonelik', 'İş', 'Kişisel Bakım', 'Hediye', 'Finansman']) {
      expect(covered.has(category)).toBe(true)
    }
  })
})
