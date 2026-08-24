import { describe, expect, it } from 'vitest'
import type { Card } from '../types/database'
import { buildPurchaseTimingHint } from './purchaseTiming'

function card(overrides: Partial<Card> = {}): Pick<Card, 'card_type' | 'statement_day' | 'due_day'> {
  return { card_type: 'kredi_karti', statement_day: 15, due_day: 25, ...overrides }
}

const day = (value: string) => new Date(`${value}T10:00:00`)

describe('buildPurchaseTimingHint', () => {
  it('kesimden önceki alışverişin bu ayın vadesinde ödendiğini söyler', () => {
    const hint = buildPurchaseTimingHint(card(), day('2026-08-12'))

    expect(hint?.dueDate).toBe('2026-08-25')
    expect(hint?.daysUntilDue).toBe(13)
    expect(hint?.daysUntilStatement).toBe(3)
  })

  it('kesim yakınken beklemenin kazandırdığı günü hesaplar', () => {
    const hint = buildPurchaseTimingHint(card(), day('2026-08-12'))

    // Kesim 15 Ağustos; 16'sında alınan aynı harcama 25 Eylül'de ödenir.
    expect(hint?.waitDueDate).toBe('2026-09-25')
    expect(hint?.gainDays).toBe(31)
    expect(hint?.waitWorthIt).toBe(true)
  })

  it('kesim uzaktayken beklemeyi önermez', () => {
    const hint = buildPurchaseTimingHint(card(), day('2026-08-02'))

    expect(hint?.daysUntilStatement).toBe(13)
    expect(hint?.waitWorthIt).toBe(false)
  })

  it('kesim günü yapılan harcama o ekstreye girer (ertesi gün değil)', () => {
    const hint = buildPurchaseTimingHint(card(), day('2026-08-15'))

    expect(hint?.dueDate).toBe('2026-08-25')
    expect(hint?.daysUntilStatement).toBe(0)
    expect(hint?.waitWorthIt).toBe(true)
  })

  it('kesimden sonra alınan harcamada bu döngü zaten sonraki aya kaymıştır', () => {
    const hint = buildPurchaseTimingHint(card(), day('2026-08-16'))

    expect(hint?.dueDate).toBe('2026-09-25')
    // Bir sonraki kesim 15 Eylül: beklemek yine bir ay kazandırır ama uzak.
    expect(hint?.waitWorthIt).toBe(false)
  })

  it('vade kesimden küçükse ödeme bir sonraki aya taşar', () => {
    const hint = buildPurchaseTimingHint(card({ statement_day: 25, due_day: 10 }), day('2026-08-20'))

    expect(hint?.dueDate).toBe('2026-09-10')
    expect(hint?.waitDueDate).toBe('2026-10-10')
  })

  it('banka kartında ve eksik gün bilgisinde ipucu üretmez', () => {
    expect(buildPurchaseTimingHint(card({ card_type: 'banka_karti' }), day('2026-08-12'))).toBeNull()
    expect(buildPurchaseTimingHint(card({ due_day: null }), day('2026-08-12'))).toBeNull()
    expect(buildPurchaseTimingHint(null, day('2026-08-12'))).toBeNull()
  })
})
