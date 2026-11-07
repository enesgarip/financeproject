import { describe, expect, it } from 'vitest'
import type { GoldLot, SavingsGoalMonthlyEntry, SavingsGoalMonthlyPlan } from '../types/database'
import { buildGoalMonthlyRows } from './goalMonthly'

const base = { id: 'plan', user_id: 'u', created_at: '', updated_at: '' }
const plan: SavingsGoalMonthlyPlan = { ...base, goal_id: 'g', effective_month: '2026-09-01', value_type: 'gram_altin', target_amount: 5, source: 'gold_buys', automatic_from: '2026-09-01' }
const lot = (date: string | null, quantity = 5, overrides: Partial<GoldLot> = {}): GoldLot => ({ ...base, purchase_date: date, gold_type: 'gram', ayar: 24, quantity, unit_price: null, direction: 'buy', note: null, ...overrides })
const entry = (month: string, amount: number): SavingsGoalMonthlyEntry => ({ ...base, goal_id: 'g', month, amount })
const today = new Date(2026, 10, 7)

describe('aylık hedef gerçekleşmeleri', () => {
  it('Eylül eksik, Ekim ve Kasım tam örneğini üretir', () => {
    const rows = buildGoalMonthlyRows('g', [plan], [], [lot('2026-10-02'), lot('2026-11-01')], today)
    expect(rows.map(row => [row.month, row.amount, row.status])).toEqual([
      ['2026-11-01', 5, 'complete'], ['2026-10-01', 5, 'complete'], ['2026-09-01', 0, 'missed'],
    ])
  })
  it('kısmi cari ayı bekletir, gelecekteki veya tarihsiz alımı ve diğer türü saymaz; satış alımı geri almaz', () => {
    const rows = buildGoalMonthlyRows('g', [plan], [], [lot('2026-11-01', 2), lot('2026-11-02', 1, { direction: 'sell' }), lot('2026-11-08', 10), lot(null, 10), lot('2026-11-02', 3, { gold_type: 'ceyrek' })], today)
    expect(rows[0]).toMatchObject({ amount: 2, status: 'pending' })
  })
  it('takip öncesindeki eksik tarihçeyi başarısız saymaz, yeterli kayıt varsa tamamlar', () => {
    const rows = buildGoalMonthlyRows('g', [{ ...plan, automatic_from: '2026-11-01' }], [], [lot('2026-10-01', 5), lot('2026-09-01', 2)], today)
    expect(rows.map(row => row.status)).toEqual(['pending', 'complete', 'unknown'])
    expect(rows[2].amount).toBe(2)
  })
  it('elle girilen toplamı otomatik alıma eklemez; sıfır açık bir gerçekleşmeme kaydıdır', () => {
    const rows = buildGoalMonthlyRows('g', [plan], [entry('2026-10-01', 0), entry('2026-11-01', 5)], [lot('2026-10-02', 5), lot('2026-11-02', 2)], today)
    expect(rows[0]).toMatchObject({ amount: 5, status: 'complete', manual: true })
    expect(rows[1]).toMatchObject({ amount: 0, status: 'missed', manual: true })
  })
  it('aylık plan değişince eski ayların hedefi ve birimi korunur; fazla alım sonraki aya taşınmaz', () => {
    const rows = buildGoalMonthlyRows('g', [plan, { ...plan, id: 'new', effective_month: '2026-11-01', target_amount: 10 }], [], [lot('2026-10-01', 20)], today)
    expect(rows.map(row => [row.plan.target_amount, row.status])).toEqual([[10, 'pending'], [5, 'complete'], [5, 'missed']])
  })
  it('yıl sınırını ve hedef izolasyonunu korur', () => {
    const early = { ...plan, effective_month: '2025-12-01', automatic_from: '2025-12-01' }
    expect(buildGoalMonthlyRows('g', [early], [entry('2025-12-01', 5)], [], today, 2025)).toHaveLength(1)
    expect(buildGoalMonthlyRows('other', [early], [], [], today)).toEqual([])
  })
  it('TL hedefi kuruşla karşılaştırır, elle kayıt yoksa başarısızlık uydurmaz', () => {
    const tl = { ...plan, value_type: 'TRY' as const, target_amount: 0.3, source: 'manual' as const, automatic_from: null }
    const rows = buildGoalMonthlyRows('g', [tl], [entry('2026-10-01', 0.1 + 0.2)], [], today)
    expect(rows.map(row => row.status)).toEqual(['pending', 'complete', 'unknown'])
  })
  it('gram miktarını kuruşa yuvarlamaz', () => {
    const small = { ...plan, target_amount: 0.005 }
    expect(buildGoalMonthlyRows('g', [small], [], [lot('2026-11-01', 0.004)], today)[0].status).toBe('pending')
    expect(buildGoalMonthlyRows('g', [small], [], [lot('2026-11-01', 0.004), lot('2026-11-02', 0.001)], today)[0].status).toBe('complete')
  })
  it('aynı karma hedefin bileşen planlarını, sürümlerini ve elle girişlerini ayırır', () => {
    const gram = { ...plan, component_id: 'gram' }
    const quarter = { ...plan, component_id: 'quarter', value_type: 'ceyrek_altin' as const, target_amount: 1 }
    const secondGram = { ...plan, component_id: 'second-gram', target_amount: 10 }
    const versions = [plan, gram, quarter, secondGram, { ...gram, effective_month: '2026-11-01', target_amount: 6 }]
    const entries = [{ ...entry('2026-11-01', 1), component_id: 'quarter' }, { ...entry('2026-11-01', 0), component_id: 'second-gram' }]
    const lots = [lot('2026-10-01', 5), lot('2026-11-01', 5)]
    const rows = (componentId?: string) => buildGoalMonthlyRows('g', versions, entries, lots, today, 2026, componentId)
    expect(rows('gram').slice(0, 2).map(row => [row.amount, row.plan.target_amount, row.status])).toEqual([[5, 6, 'pending'], [5, 5, 'complete']])
    expect(rows('quarter')[0]).toMatchObject({ amount: 1, manual: true, status: 'complete' })
    expect(rows('second-gram')[0]).toMatchObject({ amount: 0, manual: true, status: 'pending' })
    expect(rows()[0]).toMatchObject({ amount: 5, manual: false, status: 'complete' })
    expect(rows('missing')).toEqual([])
  })
})
