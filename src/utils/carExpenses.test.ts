import { describe, expect, it } from 'vitest'
import type { Car, CarExpense, CardExpense, CarReminder } from '../types/database'
import { buildCarLedgerEntries, buildCarSummaries, carReminderState } from './carExpenses'

function makeCar(id: string, name: string): Car {
  return { id, user_id: 'u1', created_at: '', updated_at: '', name, plate: null, current_odometer_km: null, sort_order: 0, note: null }
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
    fuel_liters: null,
    odometer_km: null,
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

  it('yıllık TCO, günlük maliyet ve önceki yıl karşılaştırmasını üretir', () => {
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 3100, spent_at: '2026-01-10' }),
      makeManual({ id: 'm2', car_id: 'car1', amount: 1200, spent_at: '2025-12-10' }),
    ]
    const golf = buildCarSummaries(cars, manual, [], new Date('2026-01-31T12:00:00')).find((s) => s.car.id === 'car1')!
    expect(golf.yearTotal).toBe(3100)
    expect(golf.previousYearTotal).toBe(1200)
    expect(golf.costPerDay).toBe(100)
  })

  it('ardışık kilometreli dolumlardan litre/100km ve TL/km hesaplar', () => {
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 1000, spent_at: '2026-08-01', fuel_liters: 40, odometer_km: 10_000 }),
      makeManual({ id: 'm2', car_id: 'car1', amount: 1200, spent_at: '2026-08-15', fuel_liters: 45, odometer_km: 10_600 }),
    ]
    const fuel = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!.fuel
    expect(fuel.fillupCount).toBe(2)
    expect(fuel.measuredDistanceKm).toBe(600)
    expect(fuel.litersPer100Km).toBe(7.5)
    expect(fuel.costPerKm).toBe(2)
  })

  it('odometresiz ARA dolumun litresini aralığa katar (Faz F)', () => {
    // Bulgu: ara dolumun litresi hiçbir aralığa yazılmıyordu ama mesafenin
    // TAMAMI ölçülüyordu → L/100km sistematik olarak düşük çıkıyordu.
    // 10.000 → 10.600 km arası 45 + 15 = 60 L ile kat edildi → 10 L/100km.
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 1000, spent_at: '2026-08-01', fuel_liters: 40, odometer_km: 10_000 }),
      makeManual({ id: 'm2', car_id: 'car1', amount: 400, spent_at: '2026-08-08', fuel_liters: 15, odometer_km: null }),
      makeManual({ id: 'm3', car_id: 'car1', amount: 1200, spent_at: '2026-08-15', fuel_liters: 45, odometer_km: 10_600 }),
    ]
    const fuel = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!.fuel
    expect(fuel.fillupCount).toBe(3)
    expect(fuel.measuredDistanceKm).toBe(600)
    expect(fuel.litersPer100Km).toBe(10)
    // ₺/km de ara dolumun masrafını içerir: (1200 + 400) / 600.
    expect(fuel.costPerKm).toBeCloseTo(2.67, 2)
  })

  it('odometresi GERİLEMİŞ (hatalı) satırı da bekleyen dolum sayar', () => {
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 1000, spent_at: '2026-08-01', fuel_liters: 40, odometer_km: 10_000 }),
      makeManual({ id: 'm2', car_id: 'car1', amount: 400, spent_at: '2026-08-08', fuel_liters: 15, odometer_km: 9_000 }),
      makeManual({ id: 'm3', car_id: 'car1', amount: 1200, spent_at: '2026-08-15', fuel_liters: 45, odometer_km: 10_600 }),
    ]
    const fuel = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!.fuel
    // Gerileyen okuma zinciri bozmaz: temel 10.000 kalır, mesafe 600.
    expect(fuel.measuredDistanceKm).toBe(600)
    expect(fuel.litersPer100Km).toBe(10)
  })

  it('temel (ilk) dolumun litresi hiçbir aralığa yazılmaz', () => {
    // Tank-to-tank: A→B mesafesi B'de alınan yakıtla kat edilir. Tek dolumla
    // ölçülebilir aralık yoktur → metrik null.
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 1000, spent_at: '2026-08-01', fuel_liters: 40, odometer_km: 10_000 }),
    ]
    const fuel = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!.fuel
    expect(fuel.fillupCount).toBe(1)
    expect(fuel.totalLiters).toBe(40)
    expect(fuel.measuredDistanceKm).toBe(0)
    expect(fuel.litersPer100Km).toBeNull()
    expect(fuel.costPerKm).toBeNull()
  })

  it('dolum bazlı ₺/lt serisini eski→yeni üretir; litresiz satır seriye girmez', () => {
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 1000, spent_at: '2026-08-01', fuel_liters: 42.5 }),
      makeManual({ id: 'm2', car_id: 'car1', amount: 900, spent_at: '2026-08-10' }), // litresiz — seri dışı
      makeManual({ id: 'm3', car_id: 'car1', amount: 1200, spent_at: '2026-08-15', fuel_liters: 45 }),
    ]
    const fuel = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!.fuel
    // 1000/42,5 = 23,53 (roundTL 2 hane), 1200/45 = 26,67.
    expect(fuel.unitPrices).toEqual([
      { date: '2026-08-01', pricePerLiter: 23.53 },
      { date: '2026-08-15', pricePerLiter: 26.67 },
    ])
    expect(fuel.lastFillup).toEqual({ date: '2026-08-15', pricePerLiter: 26.67 })
  })

  it('3 ay medyan kıyası: pencere dışı dolum medyana girmez, seride kalır', () => {
    const manual = [
      // 90 gün penceresinin dışında (Nisan) — medyana girmez.
      makeManual({ id: 'm0', car_id: 'car1', amount: 300, spent_at: '2026-04-01', fuel_liters: 10 }),
      makeManual({ id: 'm1', car_id: 'car1', amount: 400, spent_at: '2026-07-01', fuel_liters: 10 }), // 40/lt
      makeManual({ id: 'm2', car_id: 'car1', amount: 420, spent_at: '2026-08-01', fuel_liters: 10 }), // 42/lt
      makeManual({ id: 'm3', car_id: 'car1', amount: 480, spent_at: '2026-08-15', fuel_liters: 10 }), // 48/lt
    ]
    const fuel = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!.fuel
    expect(fuel.unitPrices).toHaveLength(4)
    // Penceredeki medyan(40, 42, 48) = 42; son dolum 48 → %14 üstünde.
    expect(fuel.medianPricePerLiter3m).toBe(42)
    expect(fuel.lastVsMedianPct).toBe(14)
  })

  it('pencerede 2 fiyatlı dolum yoksa kıyas uydurmaz', () => {
    const manual = [
      makeManual({ id: 'm1', car_id: 'car1', amount: 400, spent_at: '2026-08-15', fuel_liters: 10 }),
    ]
    const fuel = buildCarSummaries(cars, manual, [], new Date('2026-08-20')).find((s) => s.car.id === 'car1')!.fuel
    expect(fuel.lastFillup?.pricePerLiter).toBe(40)
    expect(fuel.medianPricePerLiter3m).toBeNull()
    expect(fuel.lastVsMedianPct).toBeNull()
  })
})

describe('carReminderState', () => {
  const car = { ...makeCar('car1', 'Golf'), current_odometer_km: 49_500 }
  const reminder: CarReminder = {
    id: 'r1', user_id: 'u1', created_at: '', updated_at: '', car_id: 'car1', title: 'Yağ', kind: 'bakim',
    due_date: '2026-09-01', due_odometer_km: 50_000, repeat_months: 6, repeat_km: 10_000, note: null,
  }

  it('30 gün veya 1000 km içindeki işi yaklaşan sayar', () => {
    expect(carReminderState(reminder, car, '2026-08-04')).toBe('due-soon')
  })

  it('tarih ya da kilometre geçince gecikmiş sayar', () => {
    expect(carReminderState(reminder, { ...car, current_odometer_km: 50_001 }, '2026-08-04')).toBe('overdue')
  })
})
