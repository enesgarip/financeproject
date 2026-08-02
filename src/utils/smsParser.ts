// SMS parsing — edge function (supabase/functions/parse-sms) ile senkronize.
// Değişiklik yaparsan her iki yeri de güncelle.

import { roundTL } from './money'

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
  const compact = raw.replace(/\s/g, '')
  const decimalIndex = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'))
  const decimalDigits = decimalIndex >= 0 ? compact.length - decimalIndex - 1 : 0
  const normalized = decimalIndex >= 0 && decimalDigits >= 1 && decimalDigits <= 2
    ? `${compact.slice(0, decimalIndex).replace(/[.,]/g, '')}.${compact.slice(decimalIndex + 1)}`
    : compact.replace(/[.,]/g, '')
  const amount = parseFloat(normalized)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return roundTL(amount)
}

function toIsoDate(datePart: string, timePart: string): string {
  const [d, mo, y] = datePart.split('.')
  // Banka SMS'lerindeki saat Türkiye yerel saatidir. Offset verilmezse
  // Postgres/Edge runtime değeri UTC kabul edip aktiviteyi üç saat kaydırır.
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T${timePart}+03:00`
}

// --- Regex'ler --------------------------------------------------------------

const DENIZBANK_CARD_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde\s+(\d{4})\s+ile\s+biten\s+kartinizla,\s+(.+?)\s+firmasindan,\s+([\d.,]+)\s+TL\s+islem/i

const YAPIKREDI_CARD_REGEX =
  /(\d{4})\s+ile\s+biten\s+.+?\s+kartinizla\s+(\d{2}\.\d{2}\.\d{4})\s+saat\s+(\d{2}:\d{2})'de,\s*(.+?)\s+is\s+yerinden\s+([\d.,]+)\s+TL\s+islem/i

const DENIZBANK_ACCOUNT_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})'da\s+(.+?)\s+(?:alicisina|gondericisinden)\s+([\d-]+)\s+numarali\s+hesabiniz(dan|a)\s+([\d.,]+)\s+TL\s+tutarinda\s+(\w+)\s+islemi/i

const DENIZBANK_MASKED_CARD_REGEX =
  /\d{6}\*+(\d{4})\s+kartinizla\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde\s+(.+?)\s+isyerinden\s+yapilan\s+([\d.,]+)\s+TRY\s+tutarindaki\s+islem/i

const DENIZBANK_CARD_TRANSACTION_REGEX =
  /(\d{4})\s+ile\s+biten\s+kartinizla,?\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde,?\s*([\d.,]+)\s+TL\s+tutarinda,?\s*(.+?)\s+kurumuna\s+ait\s+otomatik\s+odeme\s+talimatiniz\s+gerceklestirilmistir/i

const DENIZBANK_INCOMING_ACCOUNT_REGEX =
  /(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)'da\s+(.+?)\s+gondericisinden\s+([\d-]+)\s+numarali\s+hesabiniza\s+(FAST|HAVALE|EFT)\s+ile\s+([\d.,]+)\s+(?:TL|TRY)\s+tutarinda\s+para\s+girisi\s+gerceklesmistir/i

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

/** DenizBank'in tam maskeli kart numarasi ve TRY kullanan yeni bildirim formati. */
export function parseDenizbankMaskedCardSms(text: string): ParsedCardSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_MASKED_CARD_REGEX)
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

/** DenizKartim'in tutari merchant bilgisinden once yazan bildirim formati. */
export function parseDenizbankCardTransactionSms(text: string): ParsedCardSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_CARD_TRANSACTION_REGEX)
  if (!m) return null

  const [, lastFour, datePart, timePart, amountStr, merchant] = m
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

/** DenizBank'in FAST/HAVALE turunu tutardan once yazan gelen transfer formati. */
export function parseDenizbankIncomingAccountSms(text: string): ParsedAccountSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_INCOMING_ACCOUNT_REGEX)
  if (!m) return null

  const [, datePart, timePart, counterparty, accountNumber, txType, amountStr] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'account',
    occurredAt: toIsoDate(datePart!, timePart!),
    accountNumber: accountNumber!,
    counterparty: counterparty!.trim(),
    amount,
    direction: 'in',
    transactionType: txType!,
  }
}

export function parseSms(text: string): ParsedSms | null {
  return (
    parseDenizbankCardSms(text) ??
    parseDenizbankMaskedCardSms(text) ??
    parseDenizbankCardTransactionSms(text) ??
    parseYapikrediCardSms(text) ??
    parseDenizbankAccountSms(text) ??
    parseDenizbankIncomingAccountSms(text)
  )
}

/**
 * İçerik-hash fallback'ı saniyesiz iki gerçek hesap hareketini ayıramaz.
 * Bu formatta provider/device event ID olmadan otomatik finansal write yapılmaz.
 */
export function accountSmsNeedsExternalEventId(parsed: ParsedSms): boolean {
  return parsed.type === 'account' && /T\d{2}:\d{2}\+03:00$/.test(parsed.occurredAt)
}

// Kategori tahmini KASITLI olarak burada YOK. Kanonik kaynak src/utils/categories.ts
// (inferExpenseCategory, 13 kategori, whole-word matcher). Edge fonksiyonu
// (supabase/functions/parse-sms) kendi kategori aynasını categories.ts'ten türetir.
// Bu dosya yalnız edge'in SMS PARSING regex'lerinin test edilebilir aynasıdır.
