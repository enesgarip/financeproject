import { describe, expect, it } from 'vitest'
import { maskAmountsInText } from './useBalancePrivacy'

// K1 (denetim 2026-08-12): cümle üreten util'ler tutarı string'e gömer;
// gizlilik modunda bu kalıplar da maskelenmeli.
describe('maskAmountsInText', () => {
  it('gizli modda gömülü ₺ tutarlarını maskeler', () => {
    expect(maskAmountsInText('1.000,00 ₺ provizyon bekliyor', true)).toBe('•••• ₺ provizyon bekliyor')
    expect(maskAmountsInText('Nakit 42.500 ₺ — 3.910 ₺ açık.', true)).toBe('Nakit •••• ₺ — •••• ₺ açık.')
    expect(maskAmountsInText('aylık 1666.67 TL yük', true)).toBe('aylık •••• ₺ yük')
  })

  it('görünür modda metne dokunmaz', () => {
    const text = '1.000,00 ₺ provizyon bekliyor'
    expect(maskAmountsInText(text, false)).toBe(text)
  })

  it('tutarsız metni ve tarihleri olduğu gibi bırakır', () => {
    expect(maskAmountsInText('15 Ağu 2026 · 7. taksit', true)).toBe('15 Ağu 2026 · 7. taksit')
    expect(maskAmountsInText('%31,3 limit kullanımı', true)).toBe('%31,3 limit kullanımı')
  })
})
