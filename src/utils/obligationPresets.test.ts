import { describe, expect, it } from 'vitest'
import { OBLIGATION_PRESETS, buildPresetPayments, getPreset } from './obligationPresets'

const MTV = getPreset('mtv')!

describe('obligationPresets', () => {
  it('exposes curated Turkish presets in the Vergi / devlet category', () => {
    expect(OBLIGATION_PRESETS.length).toBeGreaterThanOrEqual(3)
    for (const p of OBLIGATION_PRESETS) {
      expect(p.category).toBe('Vergi / devlet')
      expect(p.occurrences.length).toBeGreaterThan(0)
    }
  })

  it('builds one payment per occurrence with the next future due date', () => {
    // 1 Haziran 2026: MTV Ocak taksiti geçmiş → 2027 Ocak; Temmuz → 2026 Temmuz.
    const rows = buildPresetPayments(MTV, 'u1', new Date(2026, 5, 1))
    expect(rows).toHaveLength(2)
    const dates = rows.map((r) => r.due_date).sort()
    expect(dates).toEqual(['2026-07-31', '2027-01-31'])
    expect(rows[0].category).toBe('Vergi / devlet')
    expect(rows[0].amount).toBe(0)
    expect(rows[0].amount_status).toBe('estimated')
    expect(rows[0].status).toBe('bekliyor')
    expect(rows[0].recurrence).toBe('none')
    expect(rows[0].user_id).toBe('u1')
    expect(rows[0].title).toContain('MTV')
  })

  it('skips occurrences that already exist (same title + due_date)', () => {
    const today = new Date(2026, 5, 1)
    const all = buildPresetPayments(MTV, 'u1', today)
    const existing = [{ title: all[0].title as string, due_date: all[0].due_date as string }]
    const rows = buildPresetPayments(MTV, 'u1', today, existing)
    expect(rows).toHaveLength(1)
    expect(rows[0].due_date).not.toBe(all[0].due_date)
  })

  it('uses this year when the date is still ahead', () => {
    // 1 Ocak 2026: Ocak 31 hâlâ ileride → 2026.
    const rows = buildPresetPayments(MTV, 'u1', new Date(2026, 0, 1))
    const dates = rows.map((r) => r.due_date).sort()
    expect(dates).toEqual(['2026-01-31', '2026-07-31'])
  })
})
