import { describe, expect, it } from 'vitest'
import type { SavingsGoal } from '../types/database'
import { buildForegoneGainPreview } from './foregoneGain'
import type { GoalTempo } from './goalEta'

const TODAY = new Date(2026, 7, 26)
const goal = { target_date: null } as Pick<SavingsGoal, 'target_date'>
const tempo: GoalTempo = { monthlyDelta: 10_000, spanDays: 70 }

describe('buildForegoneGainPreview', () => {
  it('gives a dated before/after when tempo allows an eta', () => {
    const preview = buildForegoneGainPreview({ goal, remaining: 60_000, amount: 20_000, tempo, today: TODAY })
    // 60k/10k = 6 ay → Şubat 2027; 40k/10k = 4 ay → Aralık 2026; 2 ay kazanç.
    expect(preview).toMatchObject({ kind: 'dated', monthsSaved: 2 })
    if (preview.kind === 'dated') {
      expect(preview.beforeLabel).toContain('2027')
      expect(preview.afterLabel).toContain('2026')
    }
  })

  it('reports completion when the amount covers the remaining', () => {
    expect(buildForegoneGainPreview({ goal, remaining: 15_000, amount: 15_000, tempo, today: TODAY })).toEqual({
      kind: 'completes',
    })
    expect(buildForegoneGainPreview({ goal, remaining: 15_000, amount: 20_000, tempo, today: TODAY })).toEqual({
      kind: 'completes',
    })
  })

  it('never invents a date without tempo or with a non-positive tempo', () => {
    expect(buildForegoneGainPreview({ goal, remaining: 60_000, amount: 20_000, tempo: null, today: TODAY })).toEqual({
      kind: 'undated',
    })
    expect(
      buildForegoneGainPreview({
        goal,
        remaining: 60_000,
        amount: 20_000,
        tempo: { monthlyDelta: -500, spanDays: 70 },
        today: TODAY,
      }),
    ).toEqual({ kind: 'undated' })
  })

  it('falls back to undated when the horizon exceeds the eta cap', () => {
    // 130 ay > 120 ay tavanı → buildGoalEta null → tarih uydurulmaz.
    const preview = buildForegoneGainPreview({
      goal,
      remaining: 1_300_000,
      amount: 10_000,
      tempo: { monthlyDelta: 10_000, spanDays: 70 },
      today: TODAY,
    })
    expect(preview).toEqual({ kind: 'undated' })
  })
})
