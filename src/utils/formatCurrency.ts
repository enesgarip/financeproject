/**
 * TL para/sayı biçimleme (gösterim) ve serbest metinden sayı ayrıştırma (giriş).
 *
 * `parseNumber` Türkçe kullanıcı girdisinin dağınıklığını tolere eder: "1.234,56",
 * "1234.56", "₺1.000", "5k" (=5000) gibi yazımları tek sayıya çevirir. Binlik/ondalık
 * ayıracını son ayıracın konumundan tahmin eder (TR'de virgül ondalık, nokta binlik).
 * Not: bu sadece GİRİŞ ayrıştırması; para hesap/yuvarlama hâlâ money.ts'in işi.
 */
export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value ?? 0)
}

const COMPACT_FORMAT = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 })

/**
 * Dar alan için kısa TL (eksen etiketi, takvim hücresi).
 * Milyon basamağı şart: ₺1.787.291 "₺1787K" diye yazılıyordu. Ondalık ayıracı
 * tr-TR (virgül). İşaret korunur — negatif bakiye eksende görünmeliydi.
 */
export function formatCompactCurrency(value: number | null | undefined) {
  const v = value ?? 0
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}₺${COMPACT_FORMAT.format(abs / 1_000_000)}M`
  if (abs >= 1_000) {
    const roundedThousands = Math.round(abs / 1_000)
    if (roundedThousands >= 1_000) {
      return `${sign}₺${COMPACT_FORMAT.format(abs / 1_000_000)}M`
    }
    return `${sign}₺${COMPACT_FORMAT.format(roundedThousands)}K`
  }
  return `${sign}₺${COMPACT_FORMAT.format(abs)}`
}

const PERCENT_FORMAT = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/**
 * tr-TR yüzde: işaret önde, **% sayıdan önce**, ondalık virgül → "%16,2".
 * İngilizce dizilim ("16.2%") aynı satırdaki ₺1.150.000,00 ile çelişiyordu.
 */
export function formatPercent(value: number | null | undefined, options?: { signed?: boolean }) {
  const v = value ?? 0
  const sign = v < 0 ? '-' : options?.signed && v > 0 ? '+' : ''
  return `${sign}%${PERCENT_FORMAT.format(Math.abs(v))}`
}

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat('tr-TR', {
    maximumFractionDigits: 2,
  }).format(value ?? 0)
}

export function parseNumber(value: FormDataEntryValue | null) {
  const raw = String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\s/g, '')
    .replace(/₺|tl/g, '')

  if (!raw) return 0

  const multiplier = raw.endsWith('k') ? 1000 : 1
  let normalized = multiplier === 1000 ? raw.slice(0, -1) : raw

  if (normalized.includes('.') && normalized.includes(',')) {
    const lastDot = normalized.lastIndexOf('.')
    const lastComma = normalized.lastIndexOf(',')
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    normalized = normalized.replaceAll(thousandsSeparator, '').replace(decimalSeparator, '.')
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.')
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    normalized = normalized.replaceAll('.', '')
  } else if (/^\d{1,3}\.\d{3}$/.test(normalized)) {
    normalized = normalized.replace('.', '')
  }

  const parsed = Number(normalized)
  // multiplier ("5k" → 5000) sonuca uygulanır. Önceden hesaplanıp yalnız 'k'
  // harfini kesmek için kullanılıyor, çarpılmıyordu → "5k" 5000 yerine 5 veriyordu.
  return Number.isFinite(parsed) ? parsed * multiplier : 0
}
