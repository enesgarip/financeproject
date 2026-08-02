// SMS parsing — edge function (supabase/functions/parse-sms) ile senkronize.
// Değişiklik yaparsan her iki yeri de güncelle.

// --- Types ------------------------------------------------------------------

export type ParsedCardSms = {
  type: 'card'
  spentAt: string
  lastFour: string
  merchant: string
  amount: number
}

export type ParsedAccountSms = {
  type: 'account'
  occurredAt: string
  accountNumber: string
  counterparty: string
  amount: number
  direction: 'in' | 'out'
  transactionType: string
}

export type ParsedSms = ParsedCardSms | ParsedAccountSms

// --- Helpers ----------------------------------------------------------------

/** SMS metinlerindeki satır sonlarını ve çoklu boşlukları tek boşluğa indirger. */
export function normalizeSmsWhitespace(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseAmount(raw: string): number | null {
  const amount = parseFloat(raw.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100) / 100
}

function toIsoDate(datePart: string, timePart: string): string {
  const [d, mo, y] = datePart.split('.')
  return `${y}-${mo}-${d}T${timePart}`
}

// --- Regex'ler --------------------------------------------------------------

const DENIZBANK_CARD_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde\s+(\d{4})\s+ile\s+biten\s+kartinizla,\s+(.+?)\s+firmasindan,\s+([\d.,]+)\s+TL\s+islem/i

const YAPIKREDI_CARD_REGEX =
  /(\d{4})\s+ile\s+biten\s+.+?\s+kartinizla\s+(\d{2}\.\d{2}\.\d{4})\s+saat\s+(\d{2}:\d{2})'de,\s*(.+?)\s+is\s+yerinden\s+([\d.,]+)\s+TL\s+islem/i

const DENIZBANK_ACCOUNT_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})'da\s+(.+?)\s+(?:alicisina|gondericisinden)\s+([\d-]+)\s+numarali\s+hesabiniz(dan|a)\s+([\d.,]+)\s+TL\s+tutarinda\s+(\w+)\s+islemi/i

// --- Parsers ----------------------------------------------------------------

export function parseDenizbankCardSms(text: string): ParsedCardSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_CARD_REGEX)
  if (!m) return null

  const [, datePart, timePart, lastFour, merchant, amountStr] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'card',
    spentAt: toIsoDate(datePart!, timePart!),
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount,
  }
}

export function parseYapikrediCardSms(text: string): ParsedCardSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(YAPIKREDI_CARD_REGEX)
  if (!m) return null

  const [, lastFour, datePart, timePart, merchant, amountStr] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'card',
    spentAt: toIsoDate(datePart!, timePart!),
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount,
  }
}

export function parseDenizbankAccountSms(text: string): ParsedAccountSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_ACCOUNT_REGEX)
  if (!m) return null

  const [, datePart, timePart, counterparty, accountNumber, dirSuffix, amountStr, txType] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'account',
    occurredAt: toIsoDate(datePart!, timePart!),
    accountNumber: accountNumber!,
    counterparty: counterparty!.trim(),
    amount,
    direction: dirSuffix === 'dan' ? 'out' : 'in',
    transactionType: txType!,
  }
}

export function parseSms(text: string): ParsedSms | null {
  return parseDenizbankCardSms(text) ?? parseYapikrediCardSms(text) ?? parseDenizbankAccountSms(text)
}

// Kategori tahmini KASITLI olarak burada YOK. Kanonik kaynak src/utils/categories.ts
// (inferExpenseCategory, 13 kategori, whole-word matcher). Edge fonksiyonu
// (supabase/functions/parse-sms) kendi kategori aynasını categories.ts'ten türetir.
// Bu dosya yalnız edge'in SMS PARSING regex'lerinin test edilebilir aynasıdır.
