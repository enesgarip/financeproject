import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthIssue } from './DataHealth.logic'
import { fixIssue } from './DataHealthPage.actions'

const mocks = vi.hoisted(() => ({
  captureUndoRows: vi.fn(),
  deleteDataHealthRows: vi.fn(),
  insertCardInstallments: vi.fn(),
  makeUndoBatch: vi.fn(() => null),
  recomputeAccountBalance: vi.fn(),
  recomputeCardDebt: vi.fn(),
  updateDataHealthRow: vi.fn(),
  updateDataHealthRows: vi.fn(),
}))

vi.mock('../data/repositories/dataHealthRepo', () => ({
  deleteDataHealthRows: mocks.deleteDataHealthRows,
  insertCardInstallments: mocks.insertCardInstallments,
  updateDataHealthRow: mocks.updateDataHealthRow,
  updateDataHealthRows: mocks.updateDataHealthRows,
}))

vi.mock('../services/accountLedgerActions', () => ({
  recomputeAccountBalance: mocks.recomputeAccountBalance,
}))

vi.mock('../services/cardLedgerActions', () => ({
  recomputeCardDebt: mocks.recomputeCardDebt,
}))

vi.mock('./DataHealth.actions', () => ({
  captureUndoRows: mocks.captureUndoRows,
  makeUndoBatch: mocks.makeUndoBatch,
}))

function ambiguousCardIssue(kind: 'cardScheduledDebt' | 'cardInstallmentOverflow'): HealthIssue {
  return {
    id: `test-${kind}`,
    area: 'Kartlar',
    severity: 'warning',
    title: 'Manuel kart kontrolü',
    description: 'Banka verisi gerekli.',
    details: [],
    fixable: false,
    kind,
    payload: { cardId: 'card-1', scheduledTotal: 120, nextDebtAmount: 120 },
  }
}

describe('DataHealthPage.actions ambiguous card debt issues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['cardScheduledDebt', 'cardInstallmentOverflow'] as const)(
    'does not mutate debt_amount for %s even with a legacy payload',
    async (kind) => {
      await expect(fixIssue(ambiguousCardIssue(kind))).resolves.toBeNull()

      expect(mocks.captureUndoRows).not.toHaveBeenCalled()
      expect(mocks.updateDataHealthRow).not.toHaveBeenCalled()
      expect(mocks.makeUndoBatch).toHaveBeenCalledWith('Manuel kart kontrolü', [])
    },
  )
})
