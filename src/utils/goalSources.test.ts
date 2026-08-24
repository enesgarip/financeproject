import { describe, expect, it } from 'vitest'
import type { Asset, Card, KasaBucket, SavingsGoal, SavingsGoalComponent, SavingsGoalSource } from '../types/database'
import { goalSourceLabel, resolveGoalSources, resolveSavingsGoalRows, suggestGoalSource } from './goalSources'
import type { MarketRatesSnapshot } from './marketRates'

const base = { id: 'id', user_id: 'u', created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' }

function asset(overrides: Partial<Asset> & { id: string }): Asset {
  return {
    ...base,
    name: 'Varlık',
    category: 'Hisse',
    amount: 0,
    unit: 'adet',
    currency: null,
    symbol: null,
    unit_cost: null,
    estimated_value_try: 0,
    auto_valued: false,
    valued_at: null,
    valuation_rate: null,
    source: null,
    note: null,
    ...overrides,
  }
}

function card(overrides: Partial<Card> & { id: string }): Card {
  return {
    ...base,
    bank_name: 'Banka',
    card_name: 'Vadesiz',
    card_type: 'banka_karti',
    holder_name: null,
    account_number: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 0,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: null,
    due_day: null,
    note: null,
    ...overrides,
  }
}

function bucket(overrides: Partial<KasaBucket> & { id: string }): KasaBucket {
  return { ...base, name: 'Kova', reserved_amount: 0, sort_order: 0, note: null, ...overrides }
}

function source(overrides: Partial<SavingsGoalSource> & { id: string; kind: SavingsGoalSource['kind'] }): SavingsGoalSource {
  return {
    ...base,
    goal_id: 'g1',
    component_id: null,
    asset_id: null,
    asset_category: null,
    card_id: null,
    bucket_id: null,
    sort_order: 0,
    ...overrides,
  }
}

function goal(overrides: Partial<SavingsGoal> & { id: string }): SavingsGoal {
  return {
    ...base,
    name: 'Hedef',
    value_type: 'TRY',
    target_amount: 0,
    current_amount: 0,
    estimated_value_try: null,
    auto_valued: false,
    valued_at: null,
    valuation_rate: null,
    target_date: null,
    status: 'active',
    note: null,
    ...overrides,
  }
}

function component(overrides: Partial<SavingsGoalComponent> & { id: string }): SavingsGoalComponent {
  return {
    ...base,
    goal_id: 'g1',
    label: null,
    value_type: 'TRY',
    target_amount: 0,
    current_amount: 0,
    sort_order: 0,
    ...overrides,
  }
}

/** Gram altın kuru taşıyan asgari snapshot. */
const snapshot: MarketRatesSnapshot = {
  rates: { GRA: { buying: 4000, selling: 4050 } },
  asOf: '2026-08-24T09:00:00.000Z',
  fetchedAt: '2026-08-24T09:00:00.000Z',
}

const stockPrices = { THYAO: 300, ASELS: 100 }

const portfolio = [
  asset({ id: 'a1', name: 'THYAO', category: 'Hisse', symbol: 'THYAO', amount: 1000, unit: 'adet', auto_valued: true, estimated_value_try: 1 }),
  asset({ id: 'a2', name: 'ASELS', category: 'Hisse', symbol: 'ASELS', amount: 500, unit: 'adet', auto_valued: true, estimated_value_try: 1 }),
  asset({ id: 'a3', name: 'Fon', category: 'Fon', amount: 1, unit: 'adet', estimated_value_try: 25_000 }),
  asset({ id: 'a4', name: 'Gram altın', category: 'Altın', amount: 30, unit: 'gram', auto_valued: true, estimated_value_try: 120_000 }),
  asset({ id: 'a5', name: 'Çeyrek', category: 'Altın', amount: 4, unit: 'adet', estimated_value_try: 28_000 }),
]

const refs = {
  assets: portfolio,
  cards: [card({ id: 'c1', current_balance: 12_500 }), card({ id: 'c2', card_type: 'kredi_karti', current_balance: 0 })],
  buckets: [bucket({ id: 'b1', name: 'Acil fon', reserved_amount: 7_500 })],
  snapshot,
  stockPrices,
}

describe('resolveGoalSources · TRY hedef', () => {
  it('tek varlığı canlı fiyatla değerler', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'asset', asset_id: 'a1' })], 'TRY', refs)

    expect(result.amount).toBe(300_000)
    expect(result.matched).toBe(1)
  })

  it('kategori bağında o kategorinin tamamını toplar', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'asset_category', asset_category: 'Hisse' })], 'TRY', refs)

    expect(result.amount).toBe(350_000)
  })

  it('banka hesabı ve kasa kovasını TL olarak ekler', () => {
    const result = resolveGoalSources(
      [
        source({ id: 's1', kind: 'bank_account', card_id: 'c1' }),
        source({ id: 's2', kind: 'kasa_bucket', bucket_id: 'b1' }),
      ],
      'TRY',
      refs,
    )

    expect(result.amount).toBe(20_000)
    expect(result.matched).toBe(2)
  })

  it('kredi kartını banka hesabı sayamaz', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'bank_account', card_id: 'c2' })], 'TRY', refs)

    expect(result.amount).toBe(0)
    expect(result.unusable).toHaveLength(1)
  })

  it('silinmiş referansı 0 saymaz, eksik olarak bildirir', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'asset', asset_id: 'yok' })], 'TRY', refs)

    expect(result.matched).toBe(0)
    expect(result.missing).toHaveLength(1)
  })

  it('"tüm varlıklar" seçiliyken varlık bağları çift saymaz', () => {
    const result = resolveGoalSources(
      [
        source({ id: 's1', kind: 'all_assets' }),
        source({ id: 's2', kind: 'asset', asset_id: 'a1' }),
        source({ id: 's3', kind: 'asset_category', asset_category: 'Hisse' }),
        source({ id: 's4', kind: 'kasa_bucket', bucket_id: 'b1' }),
      ],
      'TRY',
      refs,
    )

    // 350k hisse + 25k fon + 120k gram + 28k çeyrek + 7.5k kova
    expect(result.amount).toBe(530_500)
  })

  it('canlı fiyat yokken saklı değere düşer', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'asset', asset_id: 'a1' })], 'TRY', {
      assets: portfolio,
    })

    expect(result.amount).toBe(1)
  })
})

describe('resolveGoalSources · altın hedefi', () => {
  it('gram hedefinde altın varlıklarının MİKTARINI toplar', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'all_assets' })], 'gram_altin', refs)

    expect(result.amount).toBe(30)
  })

  it('çeyrek hedefinde adet cinsinden altını sayar', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'asset_category', asset_category: 'Altın' })], 'ceyrek_altin', refs)

    expect(result.amount).toBe(4)
  })

  it('banka hesabını gram hedefinde kullanılamaz sayar', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'bank_account', card_id: 'c1' })], 'gram_altin', refs)

    expect(result.amount).toBe(0)
    expect(result.unusable).toHaveLength(1)
  })

  it('altın dışı varlığı gram hedefine katmaz', () => {
    const result = resolveGoalSources([source({ id: 's1', kind: 'asset', asset_id: 'a1' })], 'gram_altin', refs)

    expect(result.unusable).toHaveLength(1)
  })
})

describe('resolveSavingsGoalRows', () => {
  it('kaynağı olmayan hedefi olduğu gibi bırakır', () => {
    const rows = [goal({ id: 'g1', current_amount: 42, target_amount: 100 })]

    const result = resolveSavingsGoalRows(rows, [], [], refs)

    expect(result.goals[0]).toBe(rows[0])
  })

  it('bağlı hedefin biriken tutarını kaynaklardan yazar', () => {
    const result = resolveSavingsGoalRows(
      [goal({ id: 'g1', target_amount: 1_000_000, current_amount: 0 })],
      [],
      [source({ id: 's1', kind: 'asset_category', asset_category: 'Hisse' })],
      refs,
    )

    expect(result.goals[0].current_amount).toBe(350_000)
    expect(result.goalResolutions.get('g1')?.matched).toBe(1)
  })

  it('karma hedefte sayaçları türetilmiş bileşenlerden yeniden hesaplar', () => {
    const goals = [goal({ id: 'g1', value_type: 'composite', target_amount: 2, current_amount: 0 })]
    const components = [
      component({ id: 'k1', goal_id: 'g1', value_type: 'TRY', target_amount: 300_000, current_amount: 0 }),
      component({ id: 'k2', goal_id: 'g1', value_type: 'gram_altin', target_amount: 50, current_amount: 10 }),
    ]
    const sources = [source({ id: 's1', kind: 'asset_category', asset_category: 'Hisse', component_id: 'k1' })]

    const result = resolveSavingsGoalRows(goals, components, sources, refs)

    expect(result.components[0].current_amount).toBe(350_000)
    // Bileşen 1 hedefini aştı, bileşen 2 (bağsız, 10/50) aşmadı.
    expect(result.goals[0].current_amount).toBe(1)
    expect(result.goals[0].target_amount).toBe(2)
    expect(result.componentResolutions.has('k1')).toBe(true)
  })

  it('başka hedefin kaynağını karıştırmaz', () => {
    const goals = [goal({ id: 'g1', target_amount: 100 }), goal({ id: 'g2', target_amount: 100, current_amount: 5 })]
    const sources = [source({ id: 's1', goal_id: 'g1', kind: 'kasa_bucket', bucket_id: 'b1' })]

    const result = resolveSavingsGoalRows(goals, [], sources, refs)

    expect(result.goals[0].current_amount).toBe(7_500)
    expect(result.goals[1].current_amount).toBe(5)
  })
})

describe('suggestGoalSource', () => {
  it('elle girilen tutar bir kaynağın toplamına yakınsa onu önerir', () => {
    // Hisse toplamı 350.000; kullanıcı 348.000 yazmış (%0,57 sapma).
    const suggestion = suggestGoalSource(goal({ id: 'g1', current_amount: 348_000 }), refs)

    expect(suggestion?.token).toBe('cat:Hisse')
    expect(suggestion?.amount).toBe(350_000)
  })

  it('eşik dışındaki sapmada öneri yapmaz', () => {
    // 200.000 hiçbir kaynağın toplamına (25k, 28k, 50k, 120k, 148k, 300k, 350k, 523k) yakın değil.
    expect(suggestGoalSource(goal({ id: 'g1', current_amount: 200_000 }), refs)).toBeNull()
  })

  it('eşitlikte tek varlık yerine kategoriyi önerir (yeni alım da kapsansın)', () => {
    // Tek hisseli portföyde "THYAO" ile "Hisse (tümü)" aynı tutarı verir.
    const single = {
      ...refs,
      assets: [portfolio[0]],
    }
    const suggestion = suggestGoalSource(goal({ id: 'g1', current_amount: 300_000 }), single)

    expect(suggestion?.token).toBe('cat:Hisse')
  })

  it('karma hedefte ve biriken 0 iken öneri üretmez', () => {
    expect(suggestGoalSource(goal({ id: 'g1', value_type: 'composite', current_amount: 350_000 }), refs)).toBeNull()
    expect(suggestGoalSource(goal({ id: 'g1', current_amount: 0 }), refs)).toBeNull()
  })

  it('boş kaynağı (0 TL kategori) önermez', () => {
    const empty = { ...refs, assets: [], cards: [], buckets: [] }
    expect(suggestGoalSource(goal({ id: 'g1', current_amount: 0.001 }), empty)).toBeNull()
  })

  it('altın hedefinde miktar üzerinden eşleşir', () => {
    const suggestion = suggestGoalSource(
      goal({ id: 'g1', value_type: 'gram_altin', current_amount: 30 }),
      refs,
    )

    expect(suggestion?.amount).toBe(30)
  })
})

describe('goalSourceLabel', () => {
  it('varlık ve hesap adını çözer', () => {
    expect(goalSourceLabel(source({ id: 's1', kind: 'asset', asset_id: 'a1' }), refs)).toBe('THYAO')
    expect(goalSourceLabel(source({ id: 's2', kind: 'bank_account', card_id: 'c1' }), refs)).toBe('Banka · Vadesiz')
    expect(goalSourceLabel(source({ id: 's3', kind: 'all_assets' }), refs)).toBe('Tüm varlıklarım')
  })

  it('silinmiş referansı gizlemez', () => {
    expect(goalSourceLabel(source({ id: 's1', kind: 'asset', asset_id: 'yok' }), refs)).toBe('Silinmiş varlık')
  })
})
