import { describe, expect, it } from 'vitest'
import type { Payment, TransactionHistory } from '../types/database'
import { buildPaymentEstimateSuggestion, realizedPaymentAmounts } from './paymentEstimate'

const base = { id: 'h', user_id: 'u', created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' }

function paid(id: string, amount: number, occurredAt: string, overrides: Partial<TransactionHistory> = {}): TransactionHistory {
  return {
    ...base,
    id: `${id}-${occurredAt}`,
    occurred_at: occurredAt,
    type: 'payment',
    title: 'Elektrik ödendi',
    amount,
    source_table: 'payments',
    source_id: id,
    source_event_id: null,
    note: null,
    ...overrides,
  }
}

function undo(id: string, occurredAt: string): TransactionHistory {
  return paid(id, 0, occurredAt, { title: 'Elektrik ödemesi geri alındı', amount: null })
}

function payment(overrides: Partial<Payment> = {}): Pick<Payment, 'id' | 'amount' | 'amount_status'> {
  return { id: 'p1', amount: 450, amount_status: 'estimated', ...overrides }
}

const history = [
  paid('p1', 620, '2026-05-10T09:00:00.000Z'),
  paid('p1', 780, '2026-06-10T09:00:00.000Z'),
  paid('p1', 810, '2026-07-10T09:00:00.000Z'),
  paid('p2', 5000, '2026-07-10T09:00:00.000Z'),
]

describe('realizedPaymentAmounts', () => {
  it('yalnız o ödemenin gerçekleşen tutarlarını eskiden yeniye verir', () => {
    expect(realizedPaymentAmounts('p1', history)).toEqual([620, 780, 810])
  })

  it('geri alınan ödemeyi listeden düşer', () => {
    const rows = [...history, undo('p1', '2026-07-15T09:00:00.000Z')]

    expect(realizedPaymentAmounts('p1', rows)).toEqual([620, 780])
  })

  it('başka tablodan gelen satırı saymaz', () => {
    const rows = [paid('p1', 999, '2026-08-01T09:00:00.000Z', { source_table: 'loans' })]

    expect(realizedPaymentAmounts('p1', rows)).toEqual([])
  })
})

describe('buildPaymentEstimateSuggestion', () => {
  it('bayat tahmini son ödemelerin medyanıyla tazelemeyi önerir', () => {
    const suggestion = buildPaymentEstimateSuggestion(payment(), history)

    expect(suggestion?.suggested).toBe(780)
    expect(suggestion?.sampleCount).toBe(3)
    expect(suggestion?.latest).toBe(810)
  })

  it('kesin tutarlı ödemeye karışmaz', () => {
    expect(buildPaymentEstimateSuggestion(payment({ amount_status: 'exact' }), history)).toBeNull()
  })

  it('tek gerçek ödeme eğilim sayılmaz', () => {
    const rows = [paid('p1', 900, '2026-07-10T09:00:00.000Z')]

    expect(buildPaymentEstimateSuggestion(payment(), rows)).toBeNull()
  })

  it('küçük sapmada öneri yapmaz (her ay dırdır etmez)', () => {
    // Medyan 470 vs tahmin 450: %4,4 ve 20 TL — iki eşiğin de altında.
    const rows = [paid('p1', 460, '2026-06-10T09:00:00.000Z'), paid('p1', 480, '2026-07-10T09:00:00.000Z')]

    expect(buildPaymentEstimateSuggestion(payment(), rows)).toBeNull()
  })

  it('büyük faturada oran küçük olsa da mutlak fark yetmezse susar', () => {
    // Medyan 10.020 vs tahmin 10.000: 20 TL — mutlak eşiğin altında.
    const rows = [
      paid('p1', 10_010, '2026-06-10T09:00:00.000Z'),
      paid('p1', 10_030, '2026-07-10T09:00:00.000Z'),
    ]

    expect(buildPaymentEstimateSuggestion(payment({ amount: 10_000 }), rows)).toBeNull()
  })

  it('tutarı hiç girilmemiş ("tutar bekleniyor") ödemede öneriyi mutlaka verir', () => {
    const suggestion = buildPaymentEstimateSuggestion(payment({ amount: 0 }), history)

    expect(suggestion?.suggested).toBe(780)
  })

  it('tek aylık sıçrama medyanla yumuşar', () => {
    const rows = [
      paid('p1', 700, '2026-05-10T09:00:00.000Z'),
      paid('p1', 5_000, '2026-06-10T09:00:00.000Z'),
      paid('p1', 750, '2026-07-10T09:00:00.000Z'),
    ]

    expect(buildPaymentEstimateSuggestion(payment(), rows)?.suggested).toBe(750)
  })
})
