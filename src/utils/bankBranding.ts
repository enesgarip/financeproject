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
  /** Banka adında aranacak küçük harfli anahtar kelimeler. */
  keywords: string[]
  code: string
  color: string
  name: string
}

// Sıralama önemli: daha belirgin (uzun) eşleşmeler önce gelmeli.
const BANK_BRANDS: BankBrandSeed[] = [
  { keywords: ['garanti', 'bbva', 'bonus'], code: 'GA', color: '#0EA47A', name: 'Garanti BBVA' },
  { keywords: ['akbank', 'axess', 'wings'], code: 'AK', color: '#E2001A', name: 'Akbank' },
  { keywords: ['yapı kredi', 'yapi kredi', 'yapıkredi', 'yapikredi', 'world card', 'worldcard'], code: 'YK', color: '#003B6F', name: 'Yapı Kredi' },
  { keywords: ['iş bankası', 'iş bankasi', 'is bankasi', 'işbank', 'isbank', 'maximum', 'maximİles'], code: 'İŞ', color: '#0033A0', name: 'İş Bankası' },
  { keywords: ['ziraat', 'bankkart'], code: 'ZB', color: '#C8102E', name: 'Ziraat Bankası' },
  { keywords: ['halkbank', 'halk bankası', 'halk bankasi', 'paraf'], code: 'HB', color: '#00529B', name: 'Halkbank' },
  { keywords: ['vakıf', 'vakif', 'vakıfbank', 'vakifbank'], code: 'VB', color: '#1B3A6B', name: 'VakıfBank' },
  { keywords: ['qnb', 'finansbank', 'cardfinans', 'enpara'], code: 'QNB', color: '#59328C', name: 'QNB' },
  { keywords: ['enpara'], code: 'EN', color: '#7A1FA2', name: 'Enpara' },
  { keywords: ['denizbank', 'deniz bank', 'bonus deniz'], code: 'DB', color: '#0072CE', name: 'DenizBank' },
  { keywords: ['teb', 'türk ekonomi', 'turk ekonomi'], code: 'TEB', color: '#009639', name: 'TEB' },
  { keywords: ['ing'], code: 'ING', color: '#FF6200', name: 'ING' },
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
  { keywords: [' ptt', 'ptt '], code: 'PT', color: '#FFC107', name: 'PTT' },
  { keywords: ['emlak katılım', 'emlak katilim', 'emlakbank', 'emlak bankası'], code: 'EK', color: '#0B5C3A', name: 'Emlak Katılım' },
]

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
  const seed = BANK_BRANDS.find((brand) => brand.keywords.some((keyword) => normalized.includes(keyword.trim())))

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
