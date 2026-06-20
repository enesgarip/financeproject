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
  matches: DenizBankMovementMatch[]
}

export type DenizBankMovementMatch = {
  movement: ParsedDenizBankMovement
  expense: MovementExpenseMatchRow
}

export type MovementExpenseMatchRow = {
  spent_at: string
  amount: number
  status: string
  description?: string | null
  note?: string | null
}

export type MovementPaymentMatchRow = {
  id: string
  title: string
  amount: number
  amount_status: string
  due_date: string
  status: string
  payment_method: string
  auto_source_card_id: string | null
}

export type MovementPaymentMatchResult = {
  matched: ParsedDenizBankMovement[]
  unmatched: ParsedDenizBankMovement[]
  matches: DenizBankMovementPaymentMatch[]
}

export type DenizBankMovementPaymentMatch = {
  movement: ParsedDenizBankMovement
  payment: MovementPaymentMatchRow
}

const LOOSE_DATE_MATCH_WINDOW_DAYS = 3
const PAYMENT_DATE_MATCH_WINDOW_DAYS = 7
const AMOUNT_MATCH_TOLERANCE_TL = 1

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

function paymentDueDateFromExpenseNote(note: string | null | undefined): string | null {
  const match = note?.match(/Vade:\s*(\d{4}-\d{2}-\d{2})/i)
  return match?.[1] ?? null
}

function expenseDateDistance(expense: MovementExpenseMatchRow, movementDate: string): number | null {
  const spentDistance = dateDistanceDays(expense.spent_at, movementDate)
  const paymentDueDate = paymentDueDateFromExpenseNote(expense.note)
  const dueDistance = paymentDueDate ? dateDistanceDays(paymentDueDate, movementDate) : null

  if (spentDistance == null) return dueDistance
  if (dueDistance == null) return spentDistance
  return Math.min(spentDistance, dueDistance)
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
  const matches: DenizBankMovementMatch[] = []

  for (const movement of bankMovements) {
    const exactDateCandidates: number[] = []
    const looseDateCandidates: Array<{ index: number; distance: number }> = []
    for (let index = 0; index < active.length; index++) {
      if (usedIndices.has(index)) continue
      const expense = active[index]
      const sameAmount = Math.abs(diffTL(expense.amount, movement.amount)) <= AMOUNT_MATCH_TOLERANCE_TL
      if (!sameAmount) continue

      const distance = expenseDateDistance(expense, movement.date)
      if (distance === 0) exactDateCandidates.push(index)
      else if (distance != null && distance <= LOOSE_DATE_MATCH_WINDOW_DAYS) {
        looseDateCandidates.push({ index, distance })
      }
    }

    const preferred = exactDateCandidates.find((index) => descriptionsCompatible(movement.description, active[index].description))
    const fallback = exactDateCandidates[0]
    const loosePreferred = looseDateCandidates
      .sort((left, right) => left.distance - right.distance)
      .find(({ index }) => descriptionsCompatible(movement.description, active[index].description))?.index
    const looseFallback = looseDateCandidates[0]?.index
    const foundIndex = preferred ?? fallback ?? loosePreferred ?? looseFallback

    if (foundIndex == null) {
      unmatched.push(movement)
    } else {
      usedIndices.add(foundIndex)
      matched.push(movement)
      matches.push({ movement, expense: active[foundIndex] })
    }
  }

  return { matched, unmatched, matches }
}

export function matchDenizBankMovementPayments(
  bankMovements: ParsedDenizBankMovement[],
  plannedPayments: MovementPaymentMatchRow[],
  cardId: string,
): MovementPaymentMatchResult {
  const active = plannedPayments.filter((payment) => (
    payment.status === 'bekliyor' &&
    payment.amount > 0 &&
    (!payment.auto_source_card_id || payment.auto_source_card_id === cardId)
  ))
  const usedIndices = new Set<number>()
  const matched: ParsedDenizBankMovement[] = []
  const unmatched: ParsedDenizBankMovement[] = []
  const matches: DenizBankMovementPaymentMatch[] = []

  for (const movement of bankMovements) {
    const candidates: Array<{ index: number; distance: number; titleCompatible: boolean; tiedToThisCard: boolean }> = []

    for (let index = 0; index < active.length; index++) {
      if (usedIndices.has(index)) continue
      const payment = active[index]
      const sameAmount = Math.abs(diffTL(payment.amount, movement.amount)) <= AMOUNT_MATCH_TOLERANCE_TL
      if (!sameAmount) continue

      const distance = dateDistanceDays(payment.due_date, movement.date)
      if (distance == null || distance > PAYMENT_DATE_MATCH_WINDOW_DAYS) continue

      const titleCompatible = descriptionsCompatible(movement.description, payment.title)
      const tiedToThisCard = payment.auto_source_card_id === cardId

      candidates.push({ index, distance, titleCompatible, tiedToThisCard })
    }

    const foundIndex = candidates
      .sort((left, right) => (
        Number(right.titleCompatible) - Number(left.titleCompatible) ||
        Number(right.tiedToThisCard) - Number(left.tiedToThisCard) ||
        left.distance - right.distance
      ))[0]?.index

    if (foundIndex == null) {
      unmatched.push(movement)
    } else {
      usedIndices.add(foundIndex)
      matched.push(movement)
      matches.push({ movement, payment: active[foundIndex] })
    }
  }

  return { matched, unmatched, matches }
}
