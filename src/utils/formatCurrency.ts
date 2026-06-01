export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value ?? 0)
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
  return Number.isFinite(parsed) ? parsed : 0
}
