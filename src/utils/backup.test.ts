import { describe, expect, it } from 'vitest'
import { BACKUP_TABLE_LABELS, chunk, parseBackup, RESTORE_TABLE_ORDER, rowForInsert } from './backup'

describe('parseBackup', () => {
  it('parses a v2 backup and counts restorable rows', () => {
    const text = JSON.stringify({
      exportedAt: '2026-06-10T10:00:00Z',
      schema: 'financeproject-v2',
      tables: {
        cards: [{ id: 'c1' }, { id: 'c2' }],
        kasa_buckets: [{ id: 'k1' }],
        wishlist_items: [{ id: 'w1' }],
        card_expenses: [{ id: 'e1' }],
        data_health_issue_acknowledgements: [{ id: 'a1', issue_id: 'issue-1' }],
        notification_preferences: [{ user_id: 'u1' }],
        card_current_settlements: [{ id: 's1' }], // audit-only: must be dropped
        card_ledger: [{ id: 'l1' }], // export-only: must be dropped
        unknown_table: [{ id: 'x' }],
      },
    })
    const parsed = parseBackup(text)
    expect(parsed.schema).toBe('financeproject-v2')
    expect(parsed.exportedAt).toBe('2026-06-10T10:00:00Z')
    expect(parsed.tables.cards).toHaveLength(2)
    expect(parsed.tables.kasa_buckets).toHaveLength(1)
    expect(parsed.tables.wishlist_items).toHaveLength(1)
    expect(parsed.tables.card_expenses).toHaveLength(1)
    expect(parsed.tables.data_health_issue_acknowledgements).toHaveLength(1)
    expect(parsed.tables.notification_preferences).toHaveLength(1)
    expect('card_current_settlements' in parsed.tables).toBe(false)
    expect('card_ledger' in parsed.tables).toBe(false)
    expect(parsed.totalRows).toBe(7)
    expect(parsed.counts).toEqual([
      { table: 'cards', rows: 2 },
      { table: 'kasa_buckets', rows: 1 },
      { table: 'wishlist_items', rows: 1 },
      { table: 'card_expenses', rows: 1 },
      { table: 'data_health_issue_acknowledgements', rows: 1 },
      { table: 'notification_preferences', rows: 1 },
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

  it('normalizes settlement-linked children without making paid rows billable again', () => {
    const parsed = parseBackup(JSON.stringify({
      schema: 'financeproject-v2',
      tables: {
        cards: [{ id: 'c1' }],
        card_current_settlements: [{ id: 's1' }],
        card_expenses: [
          { id: 'allocated-expense', current_settlement_id: 's1' },
          { id: 'active-expense', current_settlement_id: null },
        ],
        card_installments: [
          { id: 'paid', card_expense_id: 'active-expense', current_settlement_id: 's1', status: 'paid' },
          { id: 'posted', card_expense_id: 'active-expense', current_settlement_id: 's1', status: 'posted' },
          { id: 'orphan', card_expense_id: 'allocated-expense', current_settlement_id: 's1', status: 'paid' },
        ],
      },
    }))

    expect(parsed.tables.card_expenses).toEqual([
      { id: 'active-expense', current_settlement_id: null },
    ])
    expect(parsed.tables.card_installments).toEqual([
      { id: 'paid', card_expense_id: 'active-expense', current_settlement_id: null, status: 'paid' },
    ])
  })

  it('applies settlement normalization to legacy v1 DataHealth backups too', () => {
    const parsed = parseBackup(JSON.stringify({
      schema: 'financeproject-v1',
      data: {
        cards: [{ id: 'c1' }],
        cardExpenses: [
          { id: 'allocated-expense', current_settlement_id: 's1' },
          { id: 'active-expense', current_settlement_id: null },
        ],
        cardInstallments: [
          { id: 'paid', card_expense_id: 'active-expense', current_settlement_id: 's1', status: 'paid' },
          { id: 'posted', card_expense_id: 'active-expense', current_settlement_id: 's1', status: 'posted' },
        ],
      },
    }))

    expect(parsed.tables.card_expenses).toEqual([
      { id: 'active-expense', current_settlement_id: null },
    ])
    expect(parsed.tables.card_installments).toEqual([
      { id: 'paid', card_expense_id: 'active-expense', current_settlement_id: null, status: 'paid' },
    ])
    expect(parsed.totalRows).toBe(3)
  })

  it('rejects invalid JSON, unknown schema, and empty backups in Turkish', () => {
    expect(() => parseBackup('not json')).toThrow(/JSON değil/)
    expect(() => parseBackup('{"schema":"other","tables":{}}')).toThrow(/Tanınmayan/)
    expect(() => parseBackup('{"schema":"financeproject-v2","tables":{"cards":[]}}')).toThrow(/boş/)
  })

  it('rejects malformed, keyless, duplicate, and non-array rows before reset', () => {
    const backup = (cards: unknown) => JSON.stringify({
      schema: 'financeproject-v2',
      tables: { cards },
    })

    expect(() => parseBackup(backup([null]))).toThrow(/geçerli bir kayıt değil/)
    expect(() => parseBackup(backup([{}]))).toThrow(/id eksik/)
    expect(() => parseBackup(backup([{ id: 'c1' }, { id: 'c1' }]))).toThrow(/yinelenen id/)
    expect(() => parseBackup(backup({ id: 'c1' }))).toThrow(/liste değil/)
  })

  it('rejects malformed data-health acknowledgement issue ids before reset', () => {
    const backup = (issueId: unknown) => JSON.stringify({
      schema: 'financeproject-v2',
      tables: {
        data_health_issue_acknowledgements: [{ id: 'ack-1', issue_id: issueId }],
      },
    })

    expect(() => parseBackup(backup('   '))).toThrow(/issue_id geçersiz/)
    expect(() => parseBackup(backup('x'.repeat(2049)))).toThrow(/issue_id geçersiz/)
    expect(() => parseBackup(backup(null))).toThrow(/issue_id geçersiz/)
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
    expect(RESTORE_TABLE_ORDER).not.toContain('card_current_settlements')
    expect(pos('card_aliases')).toBeGreaterThan(pos('cards'))
    expect(pos('card_expenses')).toBeGreaterThan(pos('card_statement_archives')) // statement_archive_id
    expect(pos('card_installments')).toBeGreaterThan(pos('card_expenses')) // card_expense_id
    expect(pos('loan_installments')).toBeGreaterThan(pos('loans'))
    expect(pos('savings_goal_components')).toBeGreaterThan(pos('savings_goals'))
  })

  it('covers every user-owned table added after the original backup flow', () => {
    for (const table of ['wishlist_items', 'kasa_buckets', 'notification_preferences', 'data_health_issue_acknowledgements'] as const) {
      expect(RESTORE_TABLE_ORDER).toContain(table)
      expect(BACKUP_TABLE_LABELS[table]).toBeTruthy()
    }
  })
})
