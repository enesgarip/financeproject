import { suggestExpenseCategory } from './categories'
import { diffTL, roundTL } from './money'
import { normalizeSearchText } from './searchText'

export type DenizBankMovementBankStatus = 'pending' | 'posted'
export type DenizBankMovementAppStatus = 'provision' | 'posted'

export type ParsedDenizBankMovement = {
  bankStatus: DenizBankMovementBankStatus
  appStatus: DenizBankMovementAppStatus
  date: string
  description: string
  detail: string
  cardNo: string
  cardLastFour: string
  cardType: string
  amount: number
  bonus: number
  category: string
  isInstallment: boolean
  rawLine: string
}

export type ParsedDenizBankPayment = {
  bankStatus: DenizBankMovementBankStatus
  date: string
  description: string
  detail: string
  cardNo: string
  cardLastFour: string
  cardType: string
  amount: number
  bonus: number
  rawLine: string
}

export type ParsedDenizBankMovementFile = {
  movements: ParsedDenizBankMovement[]
  payments: ParsedDenizBankPayment[]
  ignoredRows: string[]
}

export type MovementMatchResult = {
  matched: ParsedDenizBankMovement[]
  unmatched: ParsedDenizBankMovement[]
}

export type MovementExpenseMatchRow = {
  spent_at: string
  amount: number
  status: string
  description?: string | null
}

const KNOWN_DETAILS = [
  'Otomatik Kredi Kartı Fatura Ödemesi',
  'Taksitli Satış',
  'Peşin Satış',
  'Hesaptan Ödeme',
]

const CARD_NO_PATTERN = String.raw`\d{4}\s+(?:\d{2}\*\*|\d{4})\s+(?:\*{4}|\d{4})\s+\d{4}`
const ROW_PATTERN = new RegExp(
  String.raw`^(Bekleyen İşlem|Dönem İçi)\s+(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+(${CARD_NO_PATTERN})\s+(Asıl Kart|Sanal|Sanal Kart|Ek Kart)\s+([\d.]+,\d{2})\s+TL\s+([\d.]+,\d{2})\s+TL\s*$`,
  'u',
)

function parseAmountTL(value: string): number {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? roundTL(parsed) : 0
}

function parseDate(value: string): string {
  const [day, month, year] = value.split('.')
  return `${year}-${month}-${day}`
}

function cleanDescription(value: string): string {
  return value
    .replace(/\s+[\p{L}.]+\s+(TR|TUR|GBR|IRL|NLD|USA|EUR)\s*$/iu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function splitDescriptionAndDetail(value: string) {
  for (const detail of KNOWN_DETAILS) {
    const index = value.lastIndexOf(detail)
    if (index > 0) {
      return {
        description: cleanDescription(value.slice(0, index)),
        detail,
      }
    }
    if (index === 0) {
      return { description: detail, detail }
    }
  }

  return { description: cleanDescription(value), detail: '' }
}

function movementStatus(value: string): {
  bankStatus: DenizBankMovementBankStatus
  appStatus: DenizBankMovementAppStatus
} {
  return value === 'Bekleyen İşlem'
    ? { bankStatus: 'pending', appStatus: 'provision' }
    : { bankStatus: 'posted', appStatus: 'posted' }
}

function isPaymentRow(description: string, detail: string): boolean {
  return normalizeSearchText(`${description} ${detail}`).includes('hesaptan ödeme')
}

function isInstallmentRow(description: string, detail: string): boolean {
  return normalizeSearchText(`${description} ${detail}`).includes('taksit')
}

function cardLastFour(cardNo: string): string {
  return cardNo.replace(/\s/g, '').slice(-4)
}

function descriptionMatchKey(value: string) {
  return normalizeSearchText(cleanDescription(value))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function descriptionsCompatible(left: string, right: string | null | undefined) {
  const leftKey = descriptionMatchKey(left)
  const rightKey = descriptionMatchKey(right ?? '')
  if (!leftKey || !rightKey) return true
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true

  const leftTokens = new Set(leftKey.split(' ').filter((token) => token.length >= 3))
  const rightTokens = rightKey.split(' ').filter((token) => token.length >= 3)
  const common = rightTokens.filter((token) => leftTokens.has(token)).length
  return common >= Math.min(2, rightTokens.length)
}

export function parseDenizBankMovementPdf(text: string): ParsedDenizBankMovementFile {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const movements: ParsedDenizBankMovement[] = []
  const payments: ParsedDenizBankPayment[] = []
  const ignoredRows: string[] = []

  for (const line of lines) {
    if (!line.startsWith('Bekleyen İşlem') && !line.startsWith('Dönem İçi')) continue

    const match = line.match(ROW_PATTERN)
    if (!match) {
      ignoredRows.push(line)
      continue
    }

    const [, rawType, rawDate, descriptionAndDetail, cardNo, cardType, rawAmount, rawBonus] = match
    const { bankStatus, appStatus } = movementStatus(rawType)
    const { description, detail } = splitDescriptionAndDetail(descriptionAndDetail)
    const amount = parseAmountTL(rawAmount)
    const bonus = parseAmountTL(rawBonus)
    const base = {
      bankStatus,
      date: parseDate(rawDate),
      description,
      detail,
      cardNo,
      cardLastFour: cardLastFour(cardNo),
      cardType,
      amount,
      bonus,
      rawLine: line,
    }

    if (isPaymentRow(description, detail)) {
      payments.push(base)
      continue
    }

    movements.push({
      ...base,
      appStatus,
      category: suggestExpenseCategory(description) ?? 'Diğer',
      isInstallment: isInstallmentRow(description, detail),
    })
  }

  return { movements, payments, ignoredRows }
}

export function matchDenizBankMovements(
  bankMovements: ParsedDenizBankMovement[],
  existingExpenses: MovementExpenseMatchRow[],
): MovementMatchResult {
  const active = existingExpenses.filter((expense) => expense.status !== 'cancelled')
  const usedIndices = new Set<number>()
  const matched: ParsedDenizBankMovement[] = []
  const unmatched: ParsedDenizBankMovement[] = []

  for (const movement of bankMovements) {
    const candidates: number[] = []
    for (let index = 0; index < active.length; index++) {
      if (usedIndices.has(index)) continue
      const expense = active[index]
      const sameDate = expense.spent_at === movement.date
      const sameAmount = Math.abs(diffTL(expense.amount, movement.amount)) <= 0.5
      if (sameDate && sameAmount) candidates.push(index)
    }

    const preferred = candidates.find((index) => descriptionsCompatible(movement.description, active[index].description))
    const fallback = candidates[0]
    const foundIndex = preferred ?? fallback

    if (foundIndex == null) {
      unmatched.push(movement)
    } else {
      usedIndices.add(foundIndex)
      matched.push(movement)
    }
  }

  return { matched, unmatched }
}
