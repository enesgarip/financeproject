import { suggestExpenseCategory } from './categories'
import { diffTL, roundTL } from './money'

export type ParsedTransaction = {
  date: string
  description: string
  amount: number
  category: string
  isInstallment: boolean
  /** Bu satırın kaçıncı taksit olduğu (peşin/tek çekimde 1). */
  installmentNo: number
  /** Toplam taksit sayısı; ekstrede notasyon yoksa 0 (bilinmiyor). */
  installmentCount: number
}

export type ParsedStatement = {
  cardLastFour: string
  statementDate: string
  dueDate: string
  totalDebt: number
  transactions: ParsedTransaction[]
}

export type MatchResult = {
  matched: ParsedTransaction[]
  unmatched: ParsedTransaction[]
}

// ── PDF section headers → app categories ──────────────────────────────────

const SECTION_CATEGORY: Record<string, string> = {
  'AKARYAKIT': 'Ulaşım',
  'SEYAHAT & ULAŞIM': 'Ulaşım',
  'CAFE & RESTAURANT': 'Yemek',
  'MARKET & SUPERMARKET': 'Market',
  'FAST-FOOD': 'Yemek',
  'SİGORTA': 'Diğer',
  'PASTANE': 'Yemek',
  'ECZANE': 'Sağlık',
  'OTOMOTİV': 'Diğer',
  'DİĞER İŞLEM VE HARCAMALARINIZ': 'Diğer',
  'NAKİT AVANS BİLGİLERİ': 'Diğer',
  'BONUS PROGRAM ORTAKLARINDA YAPTIĞINIZ HARCAMALAR': 'Diğer',
  'BONUS PROGRAM ORTAKLARI DIŞINDA YAPTIĞINIZ HARCAMALAR': 'Diğer',
}

const SECTION_KEYS = Object.keys(SECTION_CATEGORY)
const LOOSE_DATE_MATCH_WINDOW_DAYS = 3

// ── Helpers ────────────────────────────────────────────────────────────────

function parseAmount(s: string): number {
  return parseFloat(s.replace(/,/g, ''))
}

function parseDate(s: string): string {
  // DD/MM/YYYY → YYYY-MM-DD
  const [d, m, y] = s.split('/')
  return `${y}-${m}-${d}`
}

function cleanDescription(s: string): string {
  // Remove trailing single-word city + country code, e.g. "BURSA TR", "LONDON GBR"
  return s
    .replace(/\s+[A-ZÇĞİÖŞÜ]+\s+(TR|TUR|GBR|IRL|NLD|USA|EUR)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function sectionCategoryFor(line: string): string | null {
  const upper = line.toUpperCase()
  const key = SECTION_KEYS.find((k) => upper.includes(k))
  return key ? (SECTION_CATEGORY[key] ?? null) : null
}

function isoDayNumber(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, year, month, day] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000
}

function dateDistanceDays(left: string, right: string): number | null {
  const leftDay = isoDayNumber(left)
  const rightDay = isoDayNumber(right)
  if (leftDay == null || rightDay == null) return null
  return Math.abs(leftDay - rightDay)
}

// ── Main parser ────────────────────────────────────────────────────────────

export function parseDenizBankStatement(text: string): ParsedStatement {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  // Header fields
  let cardLastFour = ''
  let statementDate = ''
  let dueDate = ''
  let totalDebt = 0

  const cardMatch = text.match(/Kart Numarası\s+\d{4}\s+\d{2}\*{2}\s+\*{4}\s+(\d{4})/)
  if (cardMatch) cardLastFour = cardMatch[1]

  const stmtMatch = text.match(/Hesap Kesim Tarihi\s+(\d{2}\/\d{2}\/\d{4})/)
  if (stmtMatch) statementDate = parseDate(stmtMatch[1])

  const dueMatch = text.match(/Son Ödeme Tarihi\s+(\d{2}\/\d{2}\/\d{4})/)
  if (dueMatch) dueDate = parseDate(dueMatch[1])

  const totalMatch = text.match(/Dönem Borcu\s+([\d.,]+)\s+TL/)
  if (totalMatch) totalDebt = parseAmount(totalMatch[1])

  // Transaction parsing
  const transactions: ParsedTransaction[] = []
  let sectionCategory = 'Diğer'

  const DATE_PREFIX = /^\d{2}\/\d{2}\/\d{4}/
  const AMOUNT_SUFFIX = /([\d.,]+)\s+TL$/

  for (const line of lines) {
    // Non-date lines: check for section header, then skip
    if (!DATE_PREFIX.test(line)) {
      const secCat = sectionCategoryFor(line)
      if (secCat !== null) sectionCategory = secCat
      continue
    }

    // Skip payment lines (amount followed by + sign)
    if (/[\d.,]+\+\s*TL/.test(line)) continue

    // Nakit avansın faiz/BSMV/KKDF satırları Dönem Borcu'na dahildir; bunlar
    // peşin masraf olarak içeri alınır (atlanırsa toplam eksik kalır).

    // Skip Hesaptan Ödeme
    if (line.includes('Hesaptan Ödeme')) continue

    // Skip previous period header
    if (line.includes('ÖNCEKİ DÖNEM')) continue

    // Skip zero-amount entries (bonus only)
    if (/\b0[.,]00\s+TL$/.test(line)) continue

    // Extract amount from end of line
    const amountMatch = line.match(AMOUNT_SUFFIX)
    if (!amountMatch) continue
    const amount = parseAmount(amountMatch[1])
    if (amount <= 0) continue

    // Extract date
    const date = parseDate(line.substring(0, 10))

    // Everything between date and amount TL is the description region
    let descRegion = line.substring(11, line.length - amountMatch[0].length).trim()

    const isInstallment = /taksit/i.test(descRegion)

    // "Kalan Borç / Taksit" notation e.g. "43,333.33/3-1" → <kalan>/<toplam>-<kaçıncı>
    const installmentNotation = descRegion.match(/[\d.,]+\/(\d+)-(\d+)/)
    let installmentCount = isInstallment ? 0 : 1
    let installmentNo = 1
    if (installmentNotation) {
      installmentCount = Number(installmentNotation[1])
      installmentNo = Number(installmentNotation[2])
    } else if (isInstallment) {
      // Fallback: açıklamadaki "3.Tk" gibi ifadeden sıra no'su (toplam bilinmez)
      const tkMatch = descRegion.match(/(\d+)\s*\.?\s*Tk\b/i)
      if (tkMatch) installmentNo = Number(tkMatch[1])
    }

    // Strip "Kalan Borç/Taksit" notation e.g. "43,333.33/3-1"
    descRegion = descRegion.replace(/\s+[\d.,]+\/\d+-\d+\s*/g, ' ')

    // Strip trailing standalone bonus number e.g. "195.00" or "19.96"
    descRegion = descRegion.replace(/\s+\d+[.,]\d{2}\s*$/, '')

    const description = cleanDescription(descRegion)
    if (!description) continue

    // Category: prefer suggestExpenseCategory (learns from history), fall back to section
    const category = suggestExpenseCategory(description) ?? sectionCategory

    transactions.push({ date, description, amount, category, isInstallment, installmentNo, installmentCount })
  }

  return { cardLastFour, statementDate, dueDate, totalDebt, transactions }
}

// ── Matching ───────────────────────────────────────────────────────────────

/**
 * Bir kart harcamasının app'te saklanan toplam tutarını döndürür.
 * Ekstrede taksit satırı AYLIK tutarı taşır; app ise harcamayı TOPLAM tutarla
 * saklar. Toplam taksit sayısı biliniyorsa aylık × sayı ile yeniden kurulur.
 */
export function expenseTotalAmount(tx: ParsedTransaction): number {
  if (tx.isInstallment && tx.installmentCount > 1) {
    return roundTL(tx.amount * tx.installmentCount)
  }
  return tx.amount
}

export function matchTransactions(
  pdfTransactions: ParsedTransaction[],
  existingExpenses: Array<{ spent_at: string; amount: number; status: string }>,
): MatchResult {
  const active = existingExpenses.filter((e) => e.status !== 'cancelled')
  const usedIndices = new Set<number>()
  const matched: ParsedTransaction[] = []
  const unmatched: ParsedTransaction[] = []

  for (const tx of pdfTransactions) {
    // Taksitli işlem app'te orijinal tarih + TOPLAM tutarla bir harcama olarak
    // durur; bu yüzden eşleştirmede toplam tutarı kullanırız.
    const compareAmount = expenseTotalAmount(tx)
    const exactDateCandidates: number[] = []
    const looseDateCandidates: Array<{ index: number; distance: number }> = []
    for (let i = 0; i < active.length; i++) {
      if (usedIndices.has(i)) continue
      const exp = active[i]
      const sameAmount = Math.abs(diffTL(exp.amount, compareAmount)) <= 0.5
      if (!sameAmount) continue

      const distance = dateDistanceDays(exp.spent_at, tx.date)
      if (distance === 0) exactDateCandidates.push(i)
      else if (distance != null && distance <= LOOSE_DATE_MATCH_WINDOW_DAYS) {
        looseDateCandidates.push({ index: i, distance })
      }
    }
    const foundIndex = exactDateCandidates[0] ?? looseDateCandidates.sort((left, right) => left.distance - right.distance)[0]?.index
    if (foundIndex == null) {
      unmatched.push(tx)
    } else {
      usedIndices.add(foundIndex)
      matched.push(tx)
    }
  }

  return { matched, unmatched }
}
