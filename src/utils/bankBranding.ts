// Türk bankaları için tanınır marka kimliği: renk + kısa monogram kodu.
// Telifli logo görseli kullanmak yerine marka renkli rozet üretiriz; bu hem
// hızlı yüklenir hem de güvenli bir premium görünüm verir.

import { normalizeSearchText } from './searchText'

export type BankBrand = {
  /** Görsel rozette gösterilecek kısa kod (ör. GA, AK, İŞ). */
  code: string
  /** Marka ana rengi (hex). Rozet zemini olarak kullanılır. */
  color: string
  /** İnsan tarafından okunur tam ad (eşleşme bulunursa). */
  name: string
  /** Eşleşme bulunduysa true; aksi halde üretilmiş yedek kimlik. */
  matched: boolean
}

type BankBrandSeed = {
  /**
   * Banka adında aranacak küçük harfli anahtarlar (substring). NORMALIZE EDİLMİŞ
   * metinle karşılaştırılır: büyük İ/I 'i'ye katlanır, bu yüzden anahtarlarda
   * büyük harf/İ KULLANMA — 'maximİles' gibi bir anahtar asla eşleşmez.
   */
  keywords: string[]
  /**
   * Yalnız TAM KELİME olarak eşleşen anahtarlar. Çıplak substring kısa kodlarda
   * yanlış pozitif üretir ("sterling" → 'ing', "integral" → 'ing') ya da boşluk
   * şartı yüzünden tek kelimelik adı kaçırır (eski ' ptt'/'ptt ' → "PTT" hiç
   * eşleşmiyordu).
   */
  words?: string[]
  code: string
  color: string
  name: string
}

// Sıralama önemli: daha belirgin (uzun) eşleşmeler önce gelmeli. Sırayı
// bozmadan anahtar ekleme; ilk eşleşen kazanır.
const BANK_BRANDS: BankBrandSeed[] = [
  // Enpara QNB'nin dijital markası; ADI GEÇİYORSA kendi kimliğini almalı, bu
  // yüzden QNB'den ÖNCE gelir (QNB'nin 'enpara' anahtarı da kaldırıldı — o
  // anahtar bu girdiyi tümden erişilemez kılıyordu).
  { keywords: ['enpara'], code: 'EN', color: '#7A1FA2', name: 'Enpara' },
  // DenizBank de "Bonus" lisanslıdır; Garanti'nin genel 'bonus' anahtarından
  // ÖNCE gelmeli ki "Bonus Deniz" DenizBank'a düşsün.
  { keywords: ['denizbank', 'deniz bank', 'bonus deniz'], code: 'DB', color: '#0072CE', name: 'DenizBank' },
  { keywords: ['garanti', 'bbva', 'bonus'], code: 'GA', color: '#0EA47A', name: 'Garanti BBVA' },
  { keywords: ['akbank', 'axess', 'wings'], code: 'AK', color: '#E2001A', name: 'Akbank' },
  { keywords: ['yapı kredi', 'yapi kredi', 'yapıkredi', 'yapikredi', 'world card', 'worldcard'], code: 'YK', color: '#003B6F', name: 'Yapı Kredi' },
  { keywords: ['iş bankası', 'iş bankasi', 'is bankasi', 'işbank', 'isbank', 'maximum', 'maximiles'], code: 'İŞ', color: '#0033A0', name: 'İş Bankası' },
  { keywords: ['ziraat', 'bankkart'], code: 'ZB', color: '#C8102E', name: 'Ziraat Bankası' },
  { keywords: ['halkbank', 'halk bankası', 'halk bankasi', 'paraf'], code: 'HB', color: '#00529B', name: 'Halkbank' },
  { keywords: ['vakıf', 'vakif', 'vakıfbank', 'vakifbank'], code: 'VB', color: '#1B3A6B', name: 'VakıfBank' },
  { keywords: ['qnb', 'finansbank', 'cardfinans'], code: 'QNB', color: '#59328C', name: 'QNB' },
  { keywords: ['türk ekonomi', 'turk ekonomi'], words: ['teb'], code: 'TEB', color: '#009639', name: 'TEB' },
  { keywords: [], words: ['ing'], code: 'ING', color: '#FF6200', name: 'ING' },
  { keywords: ['hsbc', 'advantage'], code: 'HS', color: '#DB0011', name: 'HSBC' },
  { keywords: ['şekerbank', 'sekerbank'], code: 'ŞB', color: '#009A44', name: 'Şekerbank' },
  { keywords: ['fibabanka', 'fiba'], code: 'FB', color: '#E94E1B', name: 'Fibabanka' },
  { keywords: ['odeabank', 'odea'], code: 'OD', color: '#B81D2E', name: 'Odeabank' },
  { keywords: ['kuveyt türk', 'kuveyt turk', 'kuveytturk'], code: 'KT', color: '#00843D', name: 'Kuveyt Türk' },
  { keywords: ['albaraka'], code: 'AB', color: '#0AA06E', name: 'Albaraka' },
  { keywords: ['türkiye finans', 'turkiye finans', 'türkiyefinans'], code: 'TF', color: '#00807A', name: 'Türkiye Finans' },
  { keywords: ['anadolubank', 'anadolu bank'], code: 'AN', color: '#1F4E96', name: 'Anadolubank' },
  { keywords: ['papara'], code: 'PP', color: '#5B2C8D', name: 'Papara' },
  { keywords: ['tosla'], code: 'TO', color: '#7C3AED', name: 'Tosla' },
  { keywords: ['n26'], code: 'N26', color: '#1A1A2E', name: 'N26' },
  { keywords: ['wise'], code: 'WI', color: '#163300', name: 'Wise' },
  { keywords: ['pttbank'], words: ['ptt'], code: 'PT', color: '#FFC107', name: 'PTT' },
  { keywords: ['emlak katılım', 'emlak katilim', 'emlakbank', 'emlak bankası'], code: 'EK', color: '#0B5C3A', name: 'Emlak Katılım' },
]

/**
 * Tam kelime eşleşmesi. Lookbehind KULLANMAZ (eski Safari'de sözdizimi hatası
 * tüm modülü düşürür); onun yerine kelime sınırını karakter sınıfıyla yakalar.
 * `\b` yetmez: ASCII tabanlıdır, "tebşir" gibi Türkçe harfli komşuda sınır
 * görüp yanlış pozitif üretir.
 */
function wordMatcher(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u')
}

const BRAND_MATCHERS = BANK_BRANDS.map((seed) => ({
  seed,
  wordPatterns: (seed.words ?? []).map(wordMatcher),
}))

// Marka eşleşmesi yoksa banka adından üretilen tutarlı renk paleti.
const FALLBACK_COLORS = ['#475569', '#0E7490', '#7C3AED', '#B45309', '#0F766E', '#9333EA', '#1D4ED8', '#BE185D']

function normalize(bankName: string) {
  return normalizeSearchText(bankName)
}

function fallbackCode(bankName: string) {
  const cleaned = bankName.trim().replace(/[^\p{L}\p{N} ]/gu, ' ')
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '??'
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase('tr-TR')
  return (words[0][0] + words[1][0]).toLocaleUpperCase('tr-TR')
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

const brandCache = new Map<string, BankBrand>()

export function getBankBrand(bankName: string | null | undefined): BankBrand {
  const raw = (bankName ?? '').trim()
  const cacheKey = raw || '__empty__'
  const cached = brandCache.get(cacheKey)
  if (cached) return cached

  const normalized = normalize(raw)
  // İki eşleşme yolu: serbest substring (uzun, ayırt edici adlar) ve TAM KELİME
  // (kısa kodlar: ing/teb/ptt). Sıra BANK_BRANDS sırasıdır — ilk eşleşen kazanır.
  const seed = BRAND_MATCHERS.find(
    (matcher) =>
      matcher.seed.keywords.some((keyword) => normalized.includes(keyword.trim()))
      || matcher.wordPatterns.some((pattern) => pattern.test(normalized)),
  )?.seed

  const brand: BankBrand = seed
    ? { code: seed.code, color: seed.color, name: seed.name, matched: true }
    : {
        code: raw ? fallbackCode(raw) : '₺',
        color: FALLBACK_COLORS[hashString(normalized || 'banka') % FALLBACK_COLORS.length],
        name: raw || 'Banka',
        matched: false,
      }

  brandCache.set(cacheKey, brand)
  return brand
}

/** Rozet/kart yüzeyi için marka renginden 135° degrade üretir. */
export function bankBrandGradient(bankName: string | null | undefined) {
  const { color } = getBankBrand(bankName)
  return `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 62%, #05070d))`
}
