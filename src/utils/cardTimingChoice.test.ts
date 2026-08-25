import { describe, expect, it } from 'vitest'
import type { Card } from '../types/database'
import { buildCardTimingChoices } from './cardTimingChoice'

const base = { user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const TODAY = new Date(2026, 5, 20) // 20 Haziran 2026

function card(overrides: Partial<Card>): Card {
  return {
    ...base,
    id: 'c',
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'kredi_karti',
    holder_name: null,
    account_number: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 50_000,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: 25,
    due_day: 5,
    note: null,
    ...overrides,
  }
}

describe('buildCardTimingChoices', () => {
  it('stays silent with fewer than two credit cards', () => {
    expect(buildCardTimingChoices([card({ id: 'a' })], 1000, TODAY)).toEqual([])
    expect(
      buildCardTimingChoices([card({ id: 'a' }), card({ id: 'bank', card_type: 'banka_karti' })], 1000, TODAY),
    ).toEqual([])
  })

  it('marks the latest-paying eligible card as best and sorts by remaining days', () => {
    // A: kesim 25 Haziran → vade 5 Temmuz (yakın). B: 20 Haziran alışverişi
    // 10 Temmuz kesimine düşer → vade 20 Temmuz (daha geç ödetir).
    const choices = buildCardTimingChoices(
      [card({ id: 'a', statement_day: 25, due_day: 5 }), card({ id: 'b', statement_day: 10, due_day: 20 })],
      1000,
      TODAY,
    )
    expect(choices.map((c) => c.cardId)).toEqual(['b', 'a'])
    expect(choices[0]).toMatchObject({ isBest: true, hasSchedule: true, fitsLimit: true })
    expect(choices[1]!.isBest).toBe(false)
    expect(choices[0]!.daysUntilDue).toBeGreaterThan(choices[1]!.daysUntilDue ?? 0)
  })

  it('reads available limit from the shared limit group, not the card itself', () => {
    // Ortak grup: limit max(50k, 50k) = 50k, borç toplam 40k → kullanılabilir 10k.
    // Tek tek bakılsaydı her kart 30k boş görünürdü ve 15k "sığar" derdi.
    const shared = [
      card({ id: 'q1', limit_group_name: 'QNB', debt_amount: 20_000, statement_day: 25, due_day: 5 }),
      card({ id: 'q2', limit_group_name: 'QNB', debt_amount: 20_000, statement_day: 10, due_day: 20 }),
      card({ id: 'solo', credit_limit: 100_000, statement_day: 15, due_day: 25 }),
    ]
    const choices = buildCardTimingChoices(shared, 15_000, TODAY)
    const byId = Object.fromEntries(choices.map((c) => [c.cardId, c]))
    expect(byId.q1!.fitsLimit).toBe(false)
    expect(byId.q2!.fitsLimit).toBe(false)
    expect(byId.solo!.fitsLimit).toBe(true)
    // Limiti yeten tek kart solo — gün sayısından bağımsız en iyi o.
    expect(byId.solo!.isBest).toBe(true)
    expect(byId.q2!.isBest).toBe(false)
  })

  it('treats amount <= 0 as fitting every card', () => {
    const choices = buildCardTimingChoices(
      [card({ id: 'a', debt_amount: 50_000 }), card({ id: 'b', statement_day: 10, due_day: 20 })],
      0,
      TODAY,
    )
    expect(choices.every((c) => c.fitsLimit)).toBe(true)
  })

  it('keeps cards with missing schedule at the end, excluded from best', () => {
    const choices = buildCardTimingChoices(
      [card({ id: 'eksik', statement_day: null, due_day: null }), card({ id: 'tam' }), card({ id: 'tam2', statement_day: 10, due_day: 20 })],
      1000,
      TODAY,
    )
    expect(choices.at(-1)).toMatchObject({ cardId: 'eksik', hasSchedule: false, isBest: false, daysUntilDue: null })
  })

  it('breaks day ties by larger available limit', () => {
    const choices = buildCardTimingChoices(
      [card({ id: 'dar', debt_amount: 40_000 }), card({ id: 'genis', debt_amount: 0 })],
      1000,
      TODAY,
    )
    const best = choices.find((c) => c.isBest)
    expect(best?.cardId).toBe('genis')
  })
})
