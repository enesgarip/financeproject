import { describe, expect, it } from 'vitest'
import { buildClipboardPrefill } from './clipboardExpense'

const aliases = [
  { card_id: 'card-bonus', last_four_digits: '9032' },
  { card_id: 'card-world', last_four_digits: '4415' },
]

// smsParser.test.ts'teki gerçek format örnekleriyle aynı kalıp.
const DENIZBANK_CARD_SMS =
  'Sayin ENES GARIP, 20.08.2026 14:35:12 tarihinde 9032 ile biten kartinizla, MIGROS TICARET AS firmasindan, 1.250,75 TL islem yapilmistir.'

const DENIZBANK_OUT_SMS =
  "20.08.2026 09:15:00'da AHMET YILMAZ alicisina 1234-5678 numarali hesabinizdan 2.500,00 TL tutarinda FAST islemi gerceklesmistir."

const DENIZBANK_IN_SMS =
  "20.08.2026 11:00'da MEHMET KAYA gondericisinden 1234-5678 numarali hesabiniza FAST ile 3.000,00 TL tutarinda para girisi gerceklesmistir."

describe('buildClipboardPrefill', () => {
  it('parses a bank card SMS and matches the card via alias last-four', () => {
    const prefill = buildClipboardPrefill(DENIZBANK_CARD_SMS, aliases)
    expect(prefill).toEqual({
      kind: 'sms-card',
      amount: 1250.75,
      description: 'MIGROS TICARET AS',
      spentAt: '2026-08-20',
      cardId: 'card-bonus',
      lastFour: '9032',
    })
  })

  it('keeps cardId null when no alias matches', () => {
    const prefill = buildClipboardPrefill(DENIZBANK_CARD_SMS, [{ card_id: 'x', last_four_digits: '1111' }])
    expect(prefill).toMatchObject({ kind: 'sms-card', cardId: null, lastFour: '9032' })
  })

  it('fills outgoing account SMS without dedupe identity, rejects incoming', () => {
    expect(buildClipboardPrefill(DENIZBANK_OUT_SMS, aliases)).toEqual({
      kind: 'sms-account-out',
      amount: 2500,
      description: 'AHMET YILMAZ',
      spentAt: '2026-08-20',
    })
    expect(buildClipboardPrefill(DENIZBANK_IN_SMS, aliases)).toEqual({ kind: 'sms-account-in' })
  })

  it('extracts a TR-format amount from free text as best effort', () => {
    const prefill = buildClipboardPrefill('Siparişiniz onaylandı\nToplam: 1.849,90 TL — Trendyol', aliases)
    expect(prefill).toMatchObject({ kind: 'generic', amount: 1849.9, description: 'Siparişiniz onaylandı' })
    expect(buildClipboardPrefill('Kira ödemesi ₺22.000', aliases)).toMatchObject({ kind: 'generic', amount: 22000 })
  })

  it('returns generic with null amount when no TL pattern exists, empty for blank', () => {
    expect(buildClipboardPrefill('toplantı notları önemli', aliases)).toMatchObject({ kind: 'generic', amount: null })
    expect(buildClipboardPrefill('   \n ', aliases)).toEqual({ kind: 'empty' })
  })
})
