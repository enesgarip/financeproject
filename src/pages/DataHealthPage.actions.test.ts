import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthIssue } from './DataHealth.logic'
import {
  fixIssue,
  safeRepairBatchForIssues,
  safeRepairForIssue,
  safeRepairPlanForIssues,
} from './DataHealthPage.actions'

const mocks = vi.hoisted(() => ({
  applyDataHealthSafeRepairs: vi.fn(),
  captureUndoRows: vi.fn(),
  deleteDataHealthRows: vi.fn(),
  insertCardInstallments: vi.fn(),
  makeUndoBatch: vi.fn(() => null),
  postDueCardInstallments: vi.fn(),
  updateDataHealthRow: vi.fn(),
  updateDataHealthRows: vi.fn(),
}))

const postFixUpdatedAt = '2026-08-03T09:00:00.000Z'

vi.mock('../data/repositories/dataHealthRepo', () => ({
  deleteDataHealthRows: mocks.deleteDataHealthRows,
  insertCardInstallments: mocks.insertCardInstallments,
  updateDataHealthRow: mocks.updateDataHealthRow,
  updateDataHealthRows: mocks.updateDataHealthRows,
}))

vi.mock('../data/repositories/financeSnapshotRepo', () => ({
  postDueCardInstallments: mocks.postDueCardInstallments,
}))

vi.mock('../services/dataHealthRepairs', () => ({
  applyDataHealthSafeRepairs: mocks.applyDataHealthSafeRepairs,
}))

vi.mock('./DataHealth.actions', () => ({
  captureUndoRows: mocks.captureUndoRows,
  makeUndoBatch: mocks.makeUndoBatch,
}))

function issue(
  kind: HealthIssue['kind'],
  id: string,
  overrides: Partial<HealthIssue> = {},
): HealthIssue {
  return {
    id,
    area: 'Kartlar',
    severity: 'warning',
    title: 'Veri sağlığı bulgusu',
    description: 'Test bulgusu.',
    details: [],
    fixable: true,
    kind,
    ...overrides,
  }
}

function succeededReceipt(planned = 1) {
  return {
    receipt: {
      runId: 'run-1',
      status: 'succeeded' as const,
      planned,
      applied: planned,
      skipped: 0,
      message: null,
      idempotentReplay: false,
    },
    error: null,
  }
}

function expectNoWrite() {
  expect(mocks.applyDataHealthSafeRepairs).not.toHaveBeenCalled()
  expect(mocks.captureUndoRows).not.toHaveBeenCalled()
  expect(mocks.deleteDataHealthRows).not.toHaveBeenCalled()
  expect(mocks.insertCardInstallments).not.toHaveBeenCalled()
  expect(mocks.postDueCardInstallments).not.toHaveBeenCalled()
  expect(mocks.updateDataHealthRow).not.toHaveBeenCalled()
  expect(mocks.updateDataHealthRows).not.toHaveBeenCalled()
  expect(mocks.makeUndoBatch).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.applyDataHealthSafeRepairs.mockResolvedValue(succeededReceipt())
  mocks.captureUndoRows.mockImplementation(async (table: string, ids: string[]) => ({
    action: 'restoreRows',
    table,
    rows: ids.map((id) => ({ id, month: '2026-07-01' })),
  }))
  mocks.deleteDataHealthRows.mockResolvedValue({ ok: true, data: undefined })
  mocks.insertCardInstallments.mockResolvedValue({ ok: true, data: [] })
  mocks.postDueCardInstallments.mockResolvedValue({ ok: true, data: 1 })
  mocks.updateDataHealthRow.mockImplementation(async (_table: string, id: string) => ({
    ok: true,
    data: { id, updatedAt: postFixUpdatedAt },
  }))
  mocks.updateDataHealthRows.mockResolvedValue({ ok: true, data: undefined })
  mocks.makeUndoBatch.mockReturnValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('fixIssue policy boundary', () => {
  it('rejects a manual issue even if a legacy payload marks it fixable', async () => {
    const manualIssue = issue('cardScheduledDebt', 'card-scheduled-debt-card-1', {
      fixable: true,
      payload: {
        cardId: 'card-1',
        scheduledTotal: 120,
        nextDebtAmount: 120,
        expectedUpdatedAt: '2026-08-03T08:00:00.000Z',
      },
    })

    await expect(fixIssue(manualIssue)).rejects.toThrow(
      'ilgili inceleme akışında çözülmelidir',
    )
    expectNoWrite()
  })

  it('rejects a nonfixable guarded issue before undo or repository writes', async () => {
    const nonfixableIssue = issue('budgetMonth', 'budget-month-budget-1', {
      fixable: false,
      payload: { budgetId: 'budget-1', updates: { month: '2026-08-01' } },
    })

    await expect(fixIssue(nonfixableIssue)).rejects.toThrow(
      'tek tıkla güvenli biçimde düzeltilemez',
    )
    expectNoWrite()
  })

  it('runs the canonical due-installment maintenance instead of direct writes', async () => {
    const maintenanceIssue = issue('manual', 'card-scheduled-card-1', {
      fixable: false,
    })

    await expect(fixIssue(maintenanceIssue)).resolves.toBeNull()

    expect(mocks.postDueCardInstallments).toHaveBeenCalledOnce()
    expect(mocks.applyDataHealthSafeRepairs).not.toHaveBeenCalled()
    expect(mocks.updateDataHealthRow).not.toHaveBeenCalled()
    expect(mocks.updateDataHealthRows).not.toHaveBeenCalled()
  })

  it('never deletes peşin plan rows directly and sends the user to the owner flow', async () => {
    const structuralIssue = issue(
      'cardSingleInstallments',
      'card-expense-single-has-installments-expense-1',
      { payload: { ids: ['installment-1'] } },
    )

    await expect(fixIssue(structuralIssue)).rejects.toThrow(
      'ilgili inceleme akışında çözülmelidir',
    )
    expectNoWrite()
  })

  it('passes the scan timestamp to a guarded optimistic update', async () => {
    const expectedUpdatedAt = '2026-08-03T08:00:00.000Z'
    const guardedIssue = issue('budgetMonth', 'budget-month-budget-1', {
      payload: {
        budgetId: 'budget-1',
        updates: { month: '2026-08-01' },
        expectedUpdatedAt,
      },
    })

    await expect(fixIssue(guardedIssue)).resolves.toBeNull()

    expect(mocks.updateDataHealthRow).toHaveBeenCalledWith(
      'budgets',
      'budget-1',
      { month: '2026-08-01' },
      expectedUpdatedAt,
    )
    expect(mocks.makeUndoBatch).toHaveBeenCalledWith(
      'Veri sağlığı bulgusu',
      [{
        action: 'restoreRows',
        table: 'budgets',
        rows: [{ id: 'budget-1', month: '2026-07-01' }],
        fields: ['month'],
        expectedUpdatedAtById: { 'budget-1': postFixUpdatedAt },
      }],
    )
  })
})

describe('safeRepairForIssue', () => {
  const expectedUpdatedAt = '2026-08-03T08:00:00.000Z'

  it.each([
    ['cardLedgerDrift', 'card-ledger-drift-card-1', { cardId: 'card-1' }, 'card_ledger_recompute', 'card-1'],
    ['cardSplitDrift', 'card-split-drift-card-1', { cardId: 'card-1' }, 'card_ledger_recompute', 'card-1'],
    ['accountLedgerDrift', 'account-ledger-drift-account-1', { cardId: 'account-1' }, 'account_ledger_recompute', 'account-1'],
    ['loanTotals', 'loan-totals-loan-1', { loanId: 'loan-1' }, 'loan_summary_recompute', 'loan-1'],
    ['cardDebtSplit', 'card-split-card-2', { cardId: 'card-2' }, 'card_split_clamp', 'card-2'],
  ] as const)(
    'maps %s to %s with its optimistic timestamp',
    (kind, id, targetPayload, rule, targetId) => {
      const repair = safeRepairForIssue(
        issue(kind, id, {
          payload: { ...targetPayload, expectedUpdatedAt },
        }),
      )

      expect(repair).toEqual({ rule, targetId, expectedUpdatedAt })
    },
  )

  it('does not build a repair without expectedUpdatedAt or for a non-clamp split rule', () => {
    expect(
      safeRepairForIssue(
        issue('cardLedgerDrift', 'card-ledger-drift-card-1', {
          payload: { cardId: 'card-1' },
        }),
      ),
    ).toBeNull()
    expect(
      safeRepairForIssue(
        issue('cardDebtSplit', 'card-unclassified-debt-card-1', {
          payload: { cardId: 'card-1', expectedUpdatedAt },
        }),
      ),
    ).toBeNull()
  })
})

describe('safeRepairPlanForIssues', () => {
  it('deduplicates card ledger/split projection and includes only bulk-eligible policies', () => {
    const expectedUpdatedAt = '2026-08-03T08:00:00.000Z'
    const plan = safeRepairPlanForIssues([
      issue('cardLedgerDrift', 'card-ledger-drift-card-1', {
        payload: { cardId: 'card-1', expectedUpdatedAt },
      }),
      issue('cardSplitDrift', 'card-split-drift-card-1', {
        payload: { cardId: 'card-1', expectedUpdatedAt },
      }),
      issue('accountLedgerDrift', 'account-ledger-drift-account-1', {
        payload: { cardId: 'account-1', expectedUpdatedAt },
      }),
      issue('loanTotals', 'loan-totals-loan-1', {
        payload: { loanId: 'loan-1', expectedUpdatedAt },
      }),
      issue('cardDebtSplit', 'card-split-card-2', {
        payload: { cardId: 'card-2', expectedUpdatedAt },
      }),
      issue('budgetMonth', 'budget-month-budget-1', {
        payload: {
          budgetId: 'budget-1',
          updates: { month: '2026-08-01' },
          expectedUpdatedAt,
        },
      }),
      issue('cardScheduledDebt', 'card-scheduled-debt-card-3', {
        payload: { cardId: 'card-3', expectedUpdatedAt },
      }),
    ])

    expect(plan).toEqual([
      {
        rule: 'account_ledger_recompute',
        targetId: 'account-1',
        expectedUpdatedAt,
      },
      {
        rule: 'card_ledger_recompute',
        targetId: 'card-1',
        expectedUpdatedAt,
      },
      {
        rule: 'card_split_clamp',
        targetId: 'card-2',
        expectedUpdatedAt,
      },
    ])
  })

  it('previews at most 100 atomic repairs and reports the remainder without truncating the full plan', () => {
    const expectedUpdatedAt = '2026-08-03T08:00:00.000Z'
    const issues = Array.from({ length: 105 }, (_, index) => {
      const cardId = `card-${String(index + 1).padStart(3, '0')}`
      return issue('cardLedgerDrift', `card-ledger-drift-${cardId}`, {
        payload: { cardId, expectedUpdatedAt },
      })
    })

    expect(safeRepairPlanForIssues(issues)).toHaveLength(105)

    const batch = safeRepairBatchForIssues(issues)
    expect(batch.repairs).toHaveLength(100)
    expect(batch.issues).toHaveLength(100)
    expect(batch.remainingRepairCount).toBe(5)
    expect(batch.repairs.at(-1)?.targetId).toBe('card-100')
  })
})

describe('safe repair receipts', () => {
  const repairIssue = issue('cardLedgerDrift', 'card-ledger-drift-card-1', {
    payload: {
      cardId: 'card-1',
      expectedUpdatedAt: '2026-08-03T08:00:00.000Z',
    },
  })

  it('surfaces an optimistic conflict and performs no fallback write', async () => {
    mocks.applyDataHealthSafeRepairs.mockResolvedValue({
      receipt: {
        ...succeededReceipt().receipt,
        status: 'conflict',
        applied: 0,
        message: null,
      },
      error: null,
    })

    await expect(fixIssue(repairIssue)).rejects.toThrow(
      'Kayıt kontrol sonrasında değişti',
    )
    expect(mocks.applyDataHealthSafeRepairs).toHaveBeenCalledWith([
      {
        rule: 'card_ledger_recompute',
        targetId: 'card-1',
        expectedUpdatedAt: '2026-08-03T08:00:00.000Z',
      },
    ])
    expect(mocks.updateDataHealthRow).not.toHaveBeenCalled()
    expect(mocks.captureUndoRows).not.toHaveBeenCalled()
  })

  it('surfaces the server failure message and performs no fallback write', async () => {
    mocks.applyDataHealthSafeRepairs.mockResolvedValue({
      receipt: {
        ...succeededReceipt().receipt,
        status: 'failed',
        applied: 0,
        message: 'Ledger projeksiyonu uygulanamadı.',
      },
      error: null,
    })

    await expect(fixIssue(repairIssue)).rejects.toThrow(
      'Ledger projeksiyonu uygulanamadı.',
    )
    expect(mocks.updateDataHealthRow).not.toHaveBeenCalled()
    expect(mocks.captureUndoRows).not.toHaveBeenCalled()
  })
})

describe('missing installment safety boundary', () => {
  it('sends even future missing rows to the locked owner flow instead of REST insert', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 3, 12))
    const futureIssue = issue('cardMissingInstallments', 'card-expense-missing-expense-1', {
      payload: {
        userId: 'user-1',
        cardId: 'card-1',
        cardExpenseId: 'expense-1',
        installmentNos: [2, 3],
        installmentCount: 3,
        baseDate: '2026-09-15',
        amount: 33.33,
        totalAmount: 100,
        description: 'Taksitli alışveriş',
        category: 'Diğer',
      },
    })

    await expect(fixIssue(futureIssue)).rejects.toThrow(
      'ilgili inceleme akışında çözülmelidir',
    )
    expect(mocks.insertCardInstallments).not.toHaveBeenCalled()
    expect(mocks.makeUndoBatch).not.toHaveBeenCalled()
  })

  it('rejects a past missing installment without inserting payment history', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 3, 12))
    const pastIssue = issue('cardMissingInstallments', 'card-expense-missing-expense-1', {
      payload: {
        userId: 'user-1',
        cardId: 'card-1',
        cardExpenseId: 'expense-1',
        installmentNos: [1],
        installmentCount: 3,
        baseDate: '2026-01-15',
        amount: 33.33,
      },
    })

    await expect(fixIssue(pastIssue)).rejects.toThrow('ilgili inceleme akışında çözülmelidir')
    expect(mocks.insertCardInstallments).not.toHaveBeenCalled()
    expect(mocks.makeUndoBatch).not.toHaveBeenCalled()
  })
})

describe('guarded executor completeness', () => {
  it('does not report success when a guarded policy has no executable target', async () => {
    const missingExecutorIssue = issue('budgetMonth', 'budget-month-budget-1', {
      payload: { budgetId: 'budget-1', expectedUpdatedAt: '2026-08-03T08:00:00.000Z' },
    })

    await expect(fixIssue(missingExecutorIssue)).rejects.toThrow(
      'güvenli bir yürütücü tanımlı değil',
    )
    expect(mocks.makeUndoBatch).not.toHaveBeenCalled()
    expect(mocks.updateDataHealthRow).not.toHaveBeenCalled()
  })
})
