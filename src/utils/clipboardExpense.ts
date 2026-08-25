/**
 * "Panodan doldur" (saf): panodaki metni hızlı harcama formu ön-doldurmasına
 * çevirir. iOS Kısayolu'nun yakalamadığı banka push'ları, e-posta onayları ve
 * masaüstü kopyaları iki tıkla kayda dönsün diye.
 *
 * Metin önce `smsParser` aynasından geçer (banka SMS'iyse tutar+kart+satıcı+
 * tarih kesin çıkar); değilse en iyi çaba: TL tutar deseni + metnin kırpılmış
 * hali açıklama adayı. Kategori BURADA tahmin edilmez — setDescription sonrası
 * CategoryPicker autoApply zaten kanonik zinciri koşuyor (DRY).
 *
 * Hesap SMS'lerinde source='sms' + hash verilmez: saniyesiz formatta içerik
 * hash'i iki gerçek hareketi ayıramaz (accountSmsNeedsExternalEventId
 * gerekçesi) — yalnız form doldurulur, gelen para ise tümden reddedilir
 * (bu form GİDER formu).
 */
import type { CardAlias } from '../types/database'
import { parseSms } from './smsParser'
import { roundTL } from './money'

export type ClipboardPrefill =
  | {
      kind: 'sms-card'
      amount: number
      description: string
      /** date input date-only bekler (CLAUDE.md timestamptz gotcha) — dilimlenmiş. */
      spentAt: string
      /** Son 4 haneden alias eşleşmesi; eşleşmezse null (kullanıcı seçer). */
      cardId: string | null
      lastFour: string
    }
  | { kind: 'sms-account-out'; amount: number; description: string; spentAt: string }
  | { kind: 'sms-account-in' }
  | { kind: 'generic'; amount: number | null; description: string }
  | { kind: 'empty' }

/**
 * Serbest metinde TL tutarı: "1.234,56 TL" / "TRY 950" / "₺2.500". İlk eşleşme
 * alınır; TR biçimi (binlik nokta + ondalık virgül) smsParser'ın mantığıyla
 * aynı kurallarla çözülür.
 */
function extractGenericAmount(text: string): number | null {
  const match = text.match(/(?:₺\s*([\d.,]+))|(?:([\d.,]+)\s*(?:TL|TRY|₺))/i)
  const raw = match?.[1] ?? match?.[2]
  if (!raw) return null

  const compact = raw.replace(/\s/g, '')
  const decimalIndex = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'))
  const decimalDigits = decimalIndex >= 0 ? compact.length - decimalIndex - 1 : 0
  const normalized =
    decimalIndex >= 0 && decimalDigits >= 1 && decimalDigits <= 2
      ? `${compact.slice(0, decimalIndex).replace(/[.,]/g, '')}.${compact.slice(decimalIndex + 1)}`
      : compact.replace(/[.,]/g, '')
  const amount = parseFloat(normalized)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return roundTL(amount)
}

export function buildClipboardPrefill(
  text: string,
  aliases: Pick<CardAlias, 'card_id' | 'last_four_digits'>[],
): ClipboardPrefill {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) return { kind: 'empty' }

  const parsed = parseSms(trimmed)
  if (parsed?.type === 'card') {
    return {
      kind: 'sms-card',
      amount: parsed.amount,
      description: parsed.merchant,
      spentAt: parsed.spentAt.slice(0, 10),
      cardId: aliases.find((alias) => alias.last_four_digits === parsed.lastFour)?.card_id ?? null,
      lastFour: parsed.lastFour,
    }
  }
  if (parsed?.type === 'account') {
    if (parsed.direction === 'in') return { kind: 'sms-account-in' }
    return {
      kind: 'sms-account-out',
      amount: parsed.amount,
      description: parsed.counterparty,
      spentAt: parsed.occurredAt.slice(0, 10),
    }
  }

  return {
    kind: 'generic',
    amount: extractGenericAmount(trimmed),
    // İlk satır çoğu bildirimde en anlamlı özet; 60 karakter form alanına yeter.
    description: trimmed.split('\n')[0]!.trim().slice(0, 60),
  }
}
