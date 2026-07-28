import { describe, expect, it } from 'vitest'
import { buildSavingsCashflowAdvice, buildSavingsSuggestion } from './savingsSuggestion'

const base = {
  value_type: 'TRY' as const,
  target_amount: 100_000,
  current_amount: 40_000,
  target_date: '2026-12-31',
}

describe('buildSavingsSuggestion', () => {
  it('aktif TRY hedefte aylık gerekli = kalan / kalan ay', () => {
    // 2026-07-01 → 2026-12-31 ~ 183 gün → ceil(183/30.44)=7 ay; kalan 60k
    const result = buildSavingsSuggestion(base, new Date('2026-07-01T00:00:00'))
    expect(result.pace).toBe('active')
    expect(result.remaining).toBe(60_000)
    expect(result.monthsRemaining).toBe(7)
    expect(result.monthlyNeeded).toBeCloseTo(60_000 / 7, 2)
  })

  it('hedefe ulaşıldıysa pace reached ve monthlyNeeded 0', () => {
    const result = buildSavingsSuggestion({ ...base, current_amount: 100_000 }, new Date('2026-07-01T00:00:00'))
    expect(result.pace).toBe('reached')
    expect(result.monthlyNeeded).toBe(0)
  })

  it('hedef tarihi yoksa pace no-date, aylık null', () => {
    const result = buildSavingsSuggestion({ ...base, target_date: null }, new Date('2026-07-01T00:00:00'))
    expect(result.pace).toBe('no-date')
    expect(result.monthlyNeeded).toBeNull()
    expect(result.remaining).toBe(60_000)
  })

  it('hedef tarihi geçmiş ve tamamlanmamışsa pace overdue, kalan tek seferde', () => {
    const result = buildSavingsSuggestion(base, new Date('2027-02-01T00:00:00'))
    expect(result.pace).toBe('overdue')
    expect(result.monthsRemaining).toBe(0)
    expect(result.monthlyNeeded).toBe(60_000)
  })

  it('karma (composite) hedef desteklenmez', () => {
    const result = buildSavingsSuggestion({ ...base, value_type: 'composite' }, new Date('2026-07-01T00:00:00'))
    expect(result.pace).toBe('unsupported')
    expect(result.monthlyNeeded).toBeNull()
  })

  it('bu ay içindeki hedef en az 1 ay sayılır (sıfıra bölme yok)', () => {
    const result = buildSavingsSuggestion({ ...base, target_date: '2026-07-15' }, new Date('2026-07-10T00:00:00'))
    expect(result.monthsRemaining).toBe(1)
    expect(result.monthlyNeeded).toBe(60_000)
  })
})

describe('buildSavingsCashflowAdvice', () => {
  it('gerekli 0 ise tavsiye yok', () => {
    expect(buildSavingsCashflowAdvice(0, 5000)).toBeNull()
  })

  it('harcanabilir <= 0 ise ara ver (danger/pause)', () => {
    const advice = buildSavingsCashflowAdvice(8000, 0)
    expect(advice?.tone).toBe('danger')
    expect(advice?.kind).toBe('pause')
    expect(advice?.affordable).toBe(0)
  })

  it('harcanabilir >= gerekli ise tamamını ayır (success/full), fazlayı verir', () => {
    const advice = buildSavingsCashflowAdvice(8000, 12_000)
    expect(advice?.tone).toBe('success')
    expect(advice?.kind).toBe('full')
    expect(advice?.affordable).toBe(8000)
    expect(advice?.extra).toBe(4000)
  })

  it('0 < harcanabilir < gerekli ise kısmi ayır (warning/partial)', () => {
    const advice = buildSavingsCashflowAdvice(8000, 3000)
    expect(advice?.tone).toBe('warning')
    expect(advice?.kind).toBe('partial')
    expect(advice?.affordable).toBe(3000)
    expect(advice?.needed).toBe(8000)
  })
})
