import { describe, expect, it } from 'vitest'
import { paymentMatchKey, paymentMatchesExpense, type PaymentMatchRule } from './paymentMatching'

const water: PaymentMatchRule = { title: 'Su', amount: 385, amount_status: 'estimated' }

describe('bank payment identity', () => {
  it.each([
    [water, 'BUSKİ - BURSA SU 498149', 525, true],
    [water, 'APPLE.COM/BILL', 385, false],
    [water, 'SU MARKET', 385, false],
    [{ ...water, title: 'Elektrik' }, 'AYDIN ELEKTRIK MALZEMELERI', 385, false],
    [{ ...water, title: 'Internet' }, 'INTERNET CAFE', 385, false],
    [{ ...water, title: 'Elektrik' }, 'ULUDAG ELEKTRİK 988940', 188, true],
    [{ ...water, title: 'Doğalgaz' }, 'AKSA BURSA DOĞALGAZ 80000', 240, true],
    [{ ...water, title: 'Doğalgaz' }, 'KOZA OTOPARK VALE', 385, false],
    [{ ...water, title: 'Internet' }, 'TURKNET', 685, true],
    [{ ...water, title: 'Telefon', match_merchant: 'TURK TELEKOM MOBİL', match_reference: '543761' }, 'TURK TELEKOM MOBIL 543761', 427, true],
    [{ ...water, title: 'İGDAŞ' }, 'AKSA DOĞALGAZ', 385, false],
    [{ ...water, amount_status: 'exact' }, 'BUSKI', 525, false],
    [{ ...water, match_reference: '498149' }, 'BUSKI 498149', 525, true],
    [{ ...water, match_reference: '498149' }, 'BUSKI 4981490', 525, false],
    [{ ...water, match_reference: '498149' }, 'BUSKI', 525, false],
    [{ ...water, match_merchant: 'BUSKI' }, 'ISKI SU', 525, false],
    [{ ...water, title: 'icloud+', match_amount: 169.99 }, 'APPLE.COM/BILL', 169.99, true],
    [{ ...water, title: 'icloud+', match_amount: 169.99 }, 'APPLE.COM/BILL', 169.98, false],
    [{ ...water, title: 'icloud+', match_amount: 169.99 }, 'APPLE.COM/BILL', 659.99, false],
    [{ ...water, title: 'chatgpt', match_amount: 499.99 }, 'APPLE.COM/BILL', 499.99, true],
    [{ ...water, title: 'chatgpt', match_amount: 499.99 }, 'APPLE.COM/BILL', 169.99, false],
    [{ ...water, title: 'Spotify', amount: 99.99 }, 'SPOTIFY', 199.99, false],
    [{ ...water, title: 'Su', amount: 0 }, 'BUSKI', 525, true],
    [water, '', 385, false],
    [water, 'BUSKI', 0, false],
  ] as const)('%j / %s / %s → %s', (rule, description, amount, expected) => {
    expect(paymentMatchesExpense(rule, description, amount)).toBe(expected)
  })

  it('folds Turkish bank lettering without losing reference digits', () => {
    expect(paymentMatchKey('Iİı Şş Ğğ Üü Öö Çç 498149')).toBe('iii ss gg uu oo cc 498149')
  })
})
