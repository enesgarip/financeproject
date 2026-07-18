import { describe, expect, it } from 'vitest'
import { chunk, parseBackup, RESTORE_TABLE_ORDER, rowForInsert } from './backup'

describe('parseBackup', () => {
  it('parses a v2 backup and counts restorable rows', () => {
    const text = JSON.stringify({
      exportedAt: '2026-06-10T10:00:00Z',
      schema: 'financeproject-v2',
      tables: {
        cards: [{ id: 'c1' }, { id: 'c2' }],
        card_expenses: [{ id: 'e1' }],
        card_ledger: [{ id: 'l1' }], // export-only: must be dropped
        unknown_table: [{ id: 'x' }],
      },
    })
    const parsed = parseBackup(text)
    expect(parsed.schema).toBe('financeproject-v2')
    expect(parsed.exportedAt).toBe('2026-06-10T10:00:00Z')
    expect(parsed.tables.cards).toHaveLength(2)
    expect(parsed.tables.card_expenses).toHaveLength(1)
    expect('card_ledger' in parsed.tables).toBe(false)
    expect(parsed.totalRows).toBe(3)
    expect(parsed.counts).toEqual([
      { table: 'cards', rows: 2 },
      { table: 'card_expenses', rows: 1 },
    ])
  })

  it('parses the legacy v1 (DataHealth) format via key mapping', () => {
    const text = JSON.stringify({
      exportedAt: '2026-06-01T00:00:00Z',
      schema: 'financeproject-v1',
      data: {
        cards: [{ id: 'c1' }],
        cardExpenses: [{ id: 'e1' }, { id: 'e2' }],
        salaryHistory: [{ id: 's1' }],
      },
    })
    const parsed = parseBackup(text)
    expect(parsed.tables.cards).toHaveLength(1)
    expect(parsed.tables.card_expenses).toHaveLength(2)
    expect(parsed.tables.salary_history).toHaveLength(1)
    expect(parsed.totalRows).toBe(4)
  })

  it('rejects invalid JSON, unknown schema, and empty backups in Turkish', () => {
    expect(() => parseBackup('not json')).toThrow(/JSON değil/)
    expect(() => parseBackup('{"schema":"other","tables":{}}')).toThrow(/Tanınmayan/)
    expect(() => parseBackup('{"schema":"financeproject-v2","tables":{"cards":[]}}')).toThrow(/boş/)
  })
})

describe('rowForInsert', () => {
  it('rewrites user_id and keeps everything else (id, dates, amounts)', () => {
    const row = { id: 'r1', user_id: 'old-user', amount: 12.34, created_at: '2026-01-01' }
    expect(rowForInsert(row, 'new-user')).toEqual({ id: 'r1', user_id: 'new-user', amount: 12.34, created_at: '2026-01-01' })
  })
})

describe('chunk', () => {
  it('splits into fixed-size parts', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 200)).toEqual([])
  })
})

describe('RESTORE_TABLE_ORDER FK safety', () => {
  it('inserts parents before their children', () => {
    const pos = (t: string) => RESTORE_TABLE_ORDER.indexOf(t as (typeof RESTORE_TABLE_ORDER)[number])
    // children referencing cards
    for (const child of ['card_expenses', 'card_statement_archives', 'card_installments', 'payments', 'account_reconciliations']) {
      expect(pos(child)).toBeGreaterThan(pos('cards'))
    }
    expect(pos('card_aliases')).toBeGreaterThan(pos('cards'))
    expect(pos('card_expenses')).toBeGreaterThan(pos('card_statement_archives')) // statement_archive_id
    expect(pos('card_installments')).toBeGreaterThan(pos('card_expenses')) // card_expense_id
    expect(pos('loan_installments')).toBeGreaterThan(pos('loans'))
    expect(pos('savings_goal_components')).toBeGreaterThan(pos('savings_goals'))
  })
})
