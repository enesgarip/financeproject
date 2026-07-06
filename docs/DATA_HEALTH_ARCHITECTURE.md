# Data Health Architecture Note

Last reviewed: 2026-07-02

This note maps `/veri-sagligi` (`DataHealthPage`). Treat this route as an
operational repair surface, not a debug page: fixes can modify real finance
data.

## Responsibility

`src/pages/DataHealthPage.tsx` owns route orchestration:

- load all data-health rows from the repository
- derive visible issues through pure logic
- coordinate fix, fix-all, undo, export, restore, reset, and guided payment UI
  state
- render panels and modals from `DataHealthPage.components.tsx`

It should not contain new invariant formulas or direct Supabase calls. Keep
issue detection in `DataHealth.logic.ts` and writes in
`DataHealthPage.actions.ts` or repository/service wrappers.

## Module Map

- `DataHealthPage.tsx`: orchestration, local UI state, loading, messages,
  modal wiring
- `DataHealth.logic.ts`: pure issue detection, issue copy/view-models, undo
  batch helpers, CSV export helpers, schema-cache detection
- `DataHealthPage.actions.ts`: safe-fix execution and undo capture for each
  fixable `HealthIssue`
- `DataHealthPage.components.tsx`: issue cards, stats, and confirmation modals
- `src/hooks/useFinancePaymentDrawer.ts` and
  `src/components/finance/FinancePaymentDrawer.tsx`: guided payment actions for
  issues such as overdue open card statements
- `src/data/repositories/dataHealthRepo.ts`: table reads/writes and reset RPC
- `src/utils/backup.ts`: JSON backup parsing, export payloads, and restore flow
- `src/utils/transactionFingerprint.ts`: deterministic transaction description
  normalization, card-expense fingerprint fallback, and duplicate-candidate
  similarity scoring
- ledger utilities: `src/utils/cardLedger.ts`, `src/utils/accountLedger.ts`,
  `src/utils/financeSummary.ts`

## Issue Lifecycle

The normal flow is:

1. `fetchDataHealthRows()` loads rows from the repository.
2. `buildIssues(data)` derives deterministic `HealthIssue` objects.
3. `HealthIssueCard` presents the issue, guide, details, and optional fix.
4. Guided actions that are normal domain operations (for example paying an
   overdue open statement) should open the shared domain drawer instead of
   inventing a Data Health-only write path.
5. Manual issues that do not have a safe write should still expose a quick
   navigation action to the owning product area when possible.
6. `fixIssue(issue)` captures undo rows before each direct repair write.
7. `applyUndoEntry()` restores the latest in-session undo batch when requested.
8. `loadData()` refreshes the page after writes.

Do not add a fixable issue without an undo strategy unless the action is an
RPC recomputation with a clear backing source of truth. If a fix can delete or
rewrite user-visible rows, make the preview explicit.

## Invariant Ownership

Use existing source-of-truth helpers before adding new checks:

- card debt and card ledger drift:
  `src/utils/cardLedger.ts` and `src/utils/financeSummary.ts`
- account balance drift:
  `src/utils/accountLedger.ts`
- loan summary drift:
  `projectLoanSummary` in `src/utils/financeSummary.ts`
- card-expense duplicate signals:
  `src/utils/transactionFingerprint.ts` and the database-generated
  `card_expenses.transaction_fingerprint`
- overdue open card statements:
  `card_statement_archives.status`, `due_date`, and the existing
  `pay_card_statement` shared payment path
- legacy/passive statement statuses:
  runtime `card_statement_archives.status` values outside `open`/`paid` are
  reported as fixable data drift and normalized to `paid` without recreating
  current debt
- savings goal comparisons:
  `src/utils/savingsGoal.ts`
- money comparison and rounding:
  `src/utils/money.ts`

Data-health checks should report disagreement with those sources; they should
not create parallel formulas in page code.

## Write Safety

Every fix should be narrow and explainable:

- capture undo rows before updates/deletes
- update only the affected table and IDs
- use repository helpers for direct table writes
- use service/RPC helpers for ledger recomputation
- keep bulk fix tolerant of partial success by preserving undo entries
- reload data after success or failure

Avoid hiding schema/RPC drift. If a missing migration makes a fix impossible,
surface the error clearly rather than silently skipping a broken invariant.

## Verification

For data-health changes, usually run:

```bash
npm exec -- vitest run src/pages/DataHealth.logic.test.ts src/utils/cardLedger.test.ts src/utils/accountLedger.test.ts src/utils/financeSummary.test.ts
npm run lint
npm run test:unit
npm run build
```

For repository, RPC, RLS, or migration changes, also run local Supabase reset,
lint, and RLS audit checks when available.
