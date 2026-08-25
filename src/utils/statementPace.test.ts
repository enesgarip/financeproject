import { describe, expect, it } from 'vitest'
import { buildStatementPace, type StatementPaceExpense } from './statementPace'

// Kesim 15: 25 Ağustos'ta dönem 16 Ağu - 15 Eyl, önceki dönem 16 Tem - 15 Ağu.
const CARD = { id: 'c1', card_type: 'kredi_karti' as const, statement_day: 15, due_day: 5 }
const TODAY = new Date('2026-08-25T12:00:00')

function row(overrides: Partial<StatementPaceExpense>): StatementPaceExpense {
  return { card_id: 'c1', amount: 100, status: 'posted', spent_at: '2026-08-20', ...overrides }
}

describe('buildStatementPace', () => {
  it('banka kartında ve kesim günü olmayan kartta susar', () => {
    expect(buildStatementPace({ ...CARD, card_type: 'banka_karti' }, [row({})], TODAY)).toBeNull()
    expect(buildStatementPace({ ...CARD, statement_day: null as unknown as number }, [row({})], TODAY)).toBeNull()
  })

  it('iki yakayı da harcamalardan toplar; iptal ve başka kart dışarıda kalır', () => {
    const pace = buildStatementPace(
      CARD,
      [
        row({ spent_at: '2026-08-16', amount: 1000 }), // dönem başı, dahil
        row({ spent_at: '2026-08-25', amount: 300 }), // bugün, dahil
        row({ spent_at: '2026-08-20', amount: 999, status: 'cancelled' }), // iptal
        row({ spent_at: '2026-08-20', amount: 999, card_id: 'c2' }), // başka kart
        row({ spent_at: '2026-07-20', amount: 800 }), // önceki dönem, offset içinde
        row({ spent_at: '2026-07-25', amount: 200 }), // önceki dönemin "aynı günü", dahil
      ],
      TODAY,
    )
    expect(pace).not.toBeNull()
    expect(pace!.current).toBe(1300)
    expect(pace!.previous).toBe(1000)
    expect(pace!.deltaPct).toBe(30)
    expect(pace!.daysIntoPeriod).toBe(10)
  })

  it('önceki dönemde offset SONRASI harcama kıyasa girmez', () => {
    const pace = buildStatementPace(
      CARD,
      [
        row({ spent_at: '2026-08-20', amount: 500 }),
        row({ spent_at: '2026-07-25', amount: 400 }), // 10. gün, dahil
        row({ spent_at: '2026-07-26', amount: 5000 }), // 11. gün, HARİÇ
      ],
      TODAY,
    )
    expect(pace!.previous).toBe(400)
  })

  it('önceki dönemde hiç satır yoksa kıyas uydurulmaz (yeni kart)', () => {
    expect(buildStatementPace(CARD, [row({ spent_at: '2026-08-20' })], TODAY)).toBeNull()
  })

  it('cari taraf boşken bile önceki dönem doluysa konuşur (%-100)', () => {
    const pace = buildStatementPace(CARD, [row({ spent_at: '2026-07-20', amount: 750 })], TODAY)
    expect(pace!.current).toBe(0)
    expect(pace!.previous).toBe(750)
    expect(pace!.deltaPct).toBe(-100)
  })

  it('kısa önceki dönem sonuna kıstırılır (Şubat)', () => {
    // Kesim 1: 30 Mart'ta dönem 2 Mar - 1 Nis (29. gün), önceki dönem 2 Şub - 1 Mar (28 gün).
    const card = { ...CARD, statement_day: 1 }
    const today = new Date('2026-03-30T09:00:00')
    const pace = buildStatementPace(
      card,
      [
        row({ spent_at: '2026-03-10', amount: 600 }),
        row({ spent_at: '2026-03-01', amount: 250 }), // önceki dönemin SON günü — kıstırılmış offset dahil
      ],
      today,
    )
    expect(pace!.daysIntoPeriod).toBe(29)
    expect(pace!.previous).toBe(250)
    expect(pace!.current).toBe(600)
  })

  it('timestamptz sızıntısında gün kıyası bozulmaz', () => {
    const pace = buildStatementPace(
      CARD,
      [
        row({ spent_at: '2026-08-20T10:30:00+03:00', amount: 500 }),
        row({ spent_at: '2026-07-20T23:00:00+03:00', amount: 500 }),
      ],
      TODAY,
    )
    expect(pace!.current).toBe(500)
    expect(pace!.previous).toBe(500)
    expect(pace!.deltaPct).toBe(0)
  })
})
