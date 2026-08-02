import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HealthIssue } from './DataHealth.logic'
import {
  HEALTH_RESOLUTION_MODES,
  resolveHealthIssue,
  type HealthResolutionMode,
} from './DataHealth.resolution'

function healthIssue(
  kind: HealthIssue['kind'],
  id: string,
  overrides: Partial<HealthIssue> = {},
): HealthIssue {
  return {
    id,
    area: 'Kartlar',
    severity: 'warning',
    title: 'Test bulgusu',
    description: 'Test açıklaması',
    details: [],
    fixable: true,
    kind,
    ...overrides,
  }
}

const KIND_CASES = [
  ['cardDebtSplit', 'card-split-card-1', 'guarded_one_click', 'fix'],
  ['cardTypeFields', 'card-type-fields-card-1', 'guarded_one_click', 'fix'],
  ['cardExpenseAmount', 'card-expense-amount-expense-1', 'guided_domain_action', 'navigate'],
  ['cardSingleInstallments', 'card-expense-single-has-installments-expense-1', 'guided_domain_action', 'navigate'],
  ['cardMissingInstallments', 'card-expense-missing-expense-1', 'manual_reconciliation', 'review'],
  ['cardInstallmentDueMonth', 'card-installment-date-installment-1', 'guided_domain_action', 'navigate'],
  ['cardInstallmentPostedAt', 'card-installment-posted-at-installment-1', 'manual_reconciliation', 'review'],
  ['cardInstallmentCount', 'card-installment-count-installment-1', 'guided_domain_action', 'navigate'],
  ['cardStatementTotals', 'card-statement-totals-statement-1', 'manual_reconciliation', 'review'],
  ['cardStatementStatus', 'card-archive-status-statement-1', 'manual_reconciliation', 'review'],
  ['cardOverduePayment', 'card-overdue-statement-statement-1', 'guided_domain_action', 'payment'],
  ['cardScheduledDebt', 'card-scheduled-debt-card-1', 'manual_reconciliation', 'review'],
  ['cardScheduledDebtOverlap', 'card-scheduled-debt-overlap-card-1', 'manual_reconciliation', 'review'],
  ['cardInstallmentOverflow', 'card-installment-overflow-card-1', 'manual_reconciliation', 'review'],
  ['cardLedgerDrift', 'card-ledger-drift-card-1', 'auto_recompute', 'fix'],
  ['cardSplitDrift', 'card-split-drift-card-1', 'auto_recompute', 'fix'],
  ['duplicateTransactionCandidate', 'card-expense-duplicate-exact-a-b', 'manual_reconciliation', 'review'],
  ['cardExpenseDataQuality', 'card-expense-missing-category', 'guided_domain_action', 'review'],
  ['accountLedgerDrift', 'account-ledger-drift-card-1', 'auto_recompute', 'fix'],
  ['assetShape', 'asset-shape-asset-1', 'guarded_one_click', 'fix'],
  ['budgetMonth', 'budget-month-budget-1', 'guarded_one_click', 'fix'],
  ['debtShape', 'debt-shape-debt-1', 'guarded_one_click', 'fix'],
  ['loanTotals', 'loan-totals-loan-1', 'auto_recompute', 'fix'],
  ['loanInstallmentDueDay', 'loan-installment-due-day-installment-1', 'manual_reconciliation', 'review'],
  ['loanPaidAtMissing', 'loan-paid-at-missing', 'manual_reconciliation', 'review'],
  ['loanPendingPaidAt', 'loan-pending-paid-at', 'manual_reconciliation', 'review'],
  ['paymentRecurrenceFields', 'payment-recurrence-fields-payment-1', 'guarded_one_click', 'fix'],
  ['paymentDueDay', 'payment-due-day-payment-1', 'guarded_one_click', 'fix'],
  ['manual', 'salary-duplicate-2026-08-01', 'informational', 'review'],
] as const satisfies ReadonlyArray<
  readonly [HealthIssue['kind'], string, HealthResolutionMode, ReturnType<typeof resolveHealthIssue>['primaryAction']]
>

type MissingKind = Exclude<HealthIssue['kind'], (typeof KIND_CASES)[number][0]>
const ALL_KINDS_ARE_TESTED: MissingKind extends never ? true : never = true

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveHealthIssue exhaustive kind policy', () => {
  it('covers every HealthIssue kind with a complete resolution contract', () => {
    expect(ALL_KINDS_ARE_TESTED).toBe(true)

    for (const [kind, id, expectedMode, expectedAction] of KIND_CASES) {
      const resolution = resolveHealthIssue(healthIssue(kind, id))

      expect(resolution, `${kind}:${id}`).toMatchObject({
        mode: expectedMode,
        primaryAction: expectedAction,
      })
      expect(HEALTH_RESOLUTION_MODES).toContain(resolution.mode)
      expect(resolution.title.length).toBeGreaterThan(0)
      expect(resolution.label.length).toBeGreaterThan(0)
      expect(resolution.sourceOfTruth.length).toBeGreaterThan(0)
      expect(typeof resolution.bulkEligible).toBe('boolean')
    }
  })

  it('fails visibly at runtime if an untyped caller supplies an unknown kind', () => {
    const issue = { ...healthIssue('manual', 'unknown'), kind: 'unknown' }
    expect(() => resolveHealthIssue(issue as unknown as HealthIssue)).toThrow(
      'Bilinmeyen veri sağlığı çözüm türü',
    )
  })
})

describe('resolveHealthIssue rule semantics', () => {
  it('does not use the legacy fixable flag as authority', () => {
    const ledger = resolveHealthIssue(
      healthIssue('cardLedgerDrift', 'card-ledger-drift-card-1', { fixable: false }),
    )
    const unclassified = resolveHealthIssue(
      healthIssue('cardDebtSplit', 'card-unclassified-debt-card-1', { fixable: true }),
    )

    expect(ledger).toMatchObject({ mode: 'auto_recompute', bulkEligible: true })
    expect(unclassified).toMatchObject({ mode: 'manual_reconciliation', bulkEligible: false })
  })

  it.each([
    ['card-unclassified-debt-card-1', 'manual_reconciliation'],
    ['card-orphan-statement-debt-card-1', 'manual_reconciliation'],
    ['card-unknown-split-card-1', 'manual_reconciliation'],
  ] as const)('keeps non-invariant debt split rule %s manual', (id, mode) => {
    expect(resolveHealthIssue(healthIssue('cardDebtSplit', id)).mode).toBe(mode)
  })

  it('keeps monetary card-type normalization out of one-click and bulk fixes', () => {
    const resolution = resolveHealthIssue(
      healthIssue('cardTypeFields', 'card-type-fields-card-1', {
        payload: { updates: { debt_amount: 0, statement_day: null } },
      }),
    )

    expect(resolution).toMatchObject({
      mode: 'manual_reconciliation',
      bulkEligible: false,
      primaryAction: 'review',
    })
  })

  it.each(['assetShape', 'debtShape'] as const)(
    'protects source quantity from %s normalization',
    (kind) => {
      const resolution = resolveHealthIssue(
        healthIssue(kind, `${kind}-1`, { payload: { updates: { amount: 1 } } }),
      )
      expect(resolution.mode).toBe('manual_reconciliation')
    },
  )

  it('allows only future missing installments into the guarded one-click path', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 3, 12))

    const future = resolveHealthIssue(
      healthIssue('cardMissingInstallments', 'card-expense-missing-future', {
        payload: { baseDate: '2026-09-15', installmentNos: [1, 2] },
      }),
    )
    const past = resolveHealthIssue(
      healthIssue('cardMissingInstallments', 'card-expense-missing-past', {
        payload: { baseDate: '2026-01-15', installmentNos: [1, 2] },
      }),
    )

    expect(future.mode).toBe('guided_domain_action')
    expect(past.mode).toBe('manual_reconciliation')
  })

  it('distinguishes clearing an impossible scheduled posted_at from inventing a missing date', () => {
    const clear = resolveHealthIssue(
      healthIssue('cardInstallmentPostedAt', 'card-installment-clear-posted-at-installment-1'),
    )
    const fill = resolveHealthIssue(
      healthIssue('cardInstallmentPostedAt', 'card-installment-posted-at-installment-1'),
    )

    expect(clear.mode).toBe('guided_domain_action')
    expect(fill.mode).toBe('manual_reconciliation')
  })

  it.each([
    ['card-scheduled-card-1', 'guarded_one_click', 'fix'],
    ['loan-no-plan-loan-1', 'guided_domain_action', 'navigate'],
    ['goal-complete-active-goal-1', 'informational', 'review'],
    ['card-expense-extra-expense-1', 'manual_reconciliation', 'review'],
  ] as const)('classifies manual issue ID %s by rule semantics', (id, mode, action) => {
    expect(resolveHealthIssue(healthIssue('manual', id))).toMatchObject({
      mode,
      primaryAction: action,
      bulkEligible: false,
    })
  })
})
