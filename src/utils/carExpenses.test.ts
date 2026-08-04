import { describe, expect, it } from 'vitest'
import type { Car, CarExpense, CardExpense } from '../types/database'
import { buildCarLedgerEntries, buildCarSummaries } from './carExpenses'

function makeCar(id: string, name: string): Car {
  return { id, user_id: 'u1', created_at: '', updated_at: '', name, plate: null, sort_order: 0, note: null }
}

function makeManual(over: Partial<CarExpense> & Pick<CarExpense, 'id' | 'car_id' | 'amount'>): CarExpense {
  return {
    user_id: 'u1',
    created_at: '',
    updated_at: '',
    spent_at: '2026-08-01',
    category: 'Yakıt',
    payment_method: 'nakit',
    description: '',
    note: null,
    ...over,
  }
}

function makeCard(over: Partial<CardExpense> & Pick<CardExpense, 'id' | 'amount'>): CardExpense {
  return {
    user_id: 'u1',
    created_at: '',
    updated_at: '',
    card_id: 'c1',
    statement_archive_id: null,
    spent_at: '2026-08-02',
    description: 'Benzin',
    category: 'Yakıt',
    installment_count: 1,
    installment_amount: over.amount,
    status: 'posted',
    posted_at: null,
    note: null,
    transaction_fingerprint: null,
    source: 'manual',
    car_id: null,
    ...over,
  }
}

describe('buildCarLedgerEntries', () => {
  it('birleştirir, kart-dışı ve kartı ayrı kaynak+etiketle işaretler', () => {
    const entries = buildCarLedgerEntries(
      [makeManual({ id: 'm1', car_id: 'car1', amount: 500, payment_method: 'banka' })],
      [makeCard({ id: 'k1', amount: 300, car_id: 'car1' })],
    )
    expect(entries).toHaveLength(2)
    const card = entries.find((e) => e.source === 'card')
    const manual = entries.find((e) => e.source === 'manual')
    expect(card?.paymentLabel).toBe('Kart')
    expect(manual?.paymentLabel).toBe('Banka')
  })

  it('car_id boş kart harcamasını dışlar', () => {
    const entries = buildCarLedgerEntries([], [makeCard({ id: 'k1', amount: 300, car_id: null })])
    expect(entries).toHaveLength(0)
  })

  it('tarihe göre yeni→eski sıralar', () => {
    const entries = buildCarLedgerEntries(
      [
        makeManual({ id: 'm1', car_id: 'car1', amount: 100, spent_at: '2026-07-01' }),
        makeManual({ id: 'm2', car_id: 'car1', amount: 100, spent_at: '2026-08-15' }),
      ],
      [],
    )
    expect(entries.map((e) => e.spentAt)).toEqual(['2026-08-15', '2026-07-01'])
  })
})

describe('buildCarSummaries', () => {
  const cars = [makeCar('car1', 'Golf'), makeCar('car2', 'Clio')]

  it('araç başına toplar; kaynaklar ayrık olduğu için çift saymaz', () => {
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 500, category: 'MTV/Vergi' }),
      makeManual({ id: 'm2', car_id: 'car2', amount: 200, category: 'Yıkama' }),
    ]
    const card = [makeCard({ id: 'k1', amount: 300, car_id: 'car1', category: 'Yakıt' })]
    const summaries = buildCarSummaries(cars, manual, card, new Date('2026-08-20'))

    const golf = summaries.find((s) => s.car.id === 'car1')!
    const clio = summaries.find((s) => s.car.id === 'car2')!
    expect(golf.total).toBe(800)
    expect(golf.entryCount).toBe(2)
    expect(clio.total).toBe(200)
  })

  it('bu-ay toplamını enjekte edilen tarihe göre süzer', () => {
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 400, spent_at: '2026-08-05' }),
      makeManual({ id: 'm2', car_id: 'car1', amount: 100, spent_at: '2026-07-30' }),
    ]
    const golf = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!
    expect(golf.total).toBe(500)
    expect(golf.thisMonthTotal).toBe(400)
  })

  it('kategori kırılımını toplama göre büyük→küçük sıralar ve pay verir', () => {
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 300, category: 'Yakıt' }),
      makeManual({ id: 'm2', car_id: 'car1', amount: 100, category: 'Yıkama' }),
    ]
    const golf = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!
    expect(golf.categories.map((c) => c.category)).toEqual(['Yakıt', 'Yıkama'])
    expect(golf.categories[0]).toMatchObject({ total: 300, share: 0.75 })
  })

  it('gidersiz araç için sıfır özet döndürür', () => {
    const clio = buildCarSummaries(cars, [], [], new Date('2026-08-20')).find((s) => s.car.id === 'car2')!
    expect(clio.total).toBe(0)
    expect(clio.entryCount).toBe(0)
    expect(clio.categories).toEqual([])
  })
})
