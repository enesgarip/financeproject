import { describe, expect, it } from 'vitest'
import type { CreditScoreHistory } from '../types/database'
import { buildCreditScoreSummary, creditScoreCheckStatus } from './creditScore'

function score(id: string, value: number, checkedOn: string): CreditScoreHistory {
  return {
    id,
    user_id: 'user-1',
    score: value,
    checked_on: checkedOn,
    note: null,
    created_at: `${checkedOn}T10:00:00Z`,
    updated_at: `${checkedOn}T10:00:00Z`,
  }
}

describe('buildCreditScoreSummary', () => {
  it('tarihten bağımsız gelen satırlardan güncel ve önceki notu bulur', () => {
    const result = buildCreditScoreSummary([
      score('latest', 1450, '2026-10-01'),
      score('oldest', 1320, '2026-01-01'),
      score('previous', 1410, '2026-07-01'),
    ])

    expect(result.current?.id).toBe('latest')
    expect(result.previous?.id).toBe('previous')
    expect(result.change).toBe(40)
    expect(result.trend).toEqual([1320, 1410, 1450])
  })

  it('tek kayıtta değişim üretmez ve trend sınırını uygular', () => {
    const single = buildCreditScoreSummary([score('only', 1500, '2026-10-01')])
    expect(single.previous).toBeNull()
    expect(single.change).toBeNull()

    const limited = buildCreditScoreSummary([
      score('one', 1300, '2026-01-01'),
      score('two', 1400, '2026-02-01'),
      score('three', 1500, '2026-03-01'),
    ], 2)
    expect(limited.trend).toEqual([1400, 1500])
  })
})

describe('creditScoreCheckStatus', () => {
  it('kayıt yoksa ve son sorgudan 30 gün geçtiyse hatırlatır', () => {
    expect(creditScoreCheckStatus(null, '2026-10-06')).toEqual({ daysSinceCheck: null, due: true })
    expect(creditScoreCheckStatus(score('old', 1450, '2026-09-06'), '2026-10-06')).toEqual({
      daysSinceCheck: 30,
      due: true,
    })
  })

  it('30 günden yeni sorguyu güncel sayar ve gelecek tarihi negatife indirmez', () => {
    expect(creditScoreCheckStatus(score('recent', 1450, '2026-09-20'), '2026-10-06')).toEqual({
      daysSinceCheck: 16,
      due: false,
    })
    expect(creditScoreCheckStatus(score('future', 1450, '2026-10-07'), '2026-10-06')).toEqual({
      daysSinceCheck: 0,
      due: false,
    })
  })
})
