# Data Health Architecture Note

Last reviewed: 2026-08-02

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
- `DataHealth.logic.ts`: thin pure issue orchestrator, issue/view-model types,
  undo batch helpers, CSV export helpers, schema-cache detection
- `DataHealth.checks.ts`: domain-specific pure issue detection, including card
  scheduled-debt gap and partial-overlap checks
- `DataHealthPage.actions.ts`: safe-fix execution and undo capture for each
  fixable `HealthIssue`
- `DataHealthPage.components.tsx`: issue cards, stats, and confirmation modals
- `src/hooks/useFinancePaymentDrawer.ts` and
  `src/components/finance/FinancePaymentDrawer.tsx`: guided payment actions for
  issues such as overdue open card statements
- `src/data/repositories/dataHealthRepo.ts`: immutable-PK keyset table reads,
  narrow writes, and reset RPC
- `src/utils/backup.ts`: JSON backup parsing, export payloads, and restore flow
- `src/utils/transactionFingerprint.ts`: deterministic transaction description
  normalization, card-expense fingerprint fallback, and duplicate-candidate
  similarity scoring
- ledger utilities: `src/utils/cardLedger.ts`, `src/utils/accountLedger.ts`,
  `src/utils/financeSummary.ts`

## Issue Lifecycle

The normal flow is:

1. `fetchDataHealthRows()` loads every row with keyset pagination. Separate REST
   pages are not one transaction snapshot; concurrent inserts/deletes may change
   membership, but offset boundary shifts cannot skip/duplicate remaining rows.
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
- scheduled installment composition:
  `cardDebtBreakdown()` distinguishes a wholly missing scheduled-debt gap from a
  partial scheduled overlap; neither identifies a replacement debt without bank
  truth
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
  reported for manual reconciliation; marking one paid is a bank/card payment
  transition and must not be a direct Data Health row update
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
- never write aggregate card debt from scheduled-debt gap/overlap or installment
  overflow warnings; those issues are intentionally non-fixable
- never auto-rewrite installment structure when the expense or any sibling child
  is linked to a statement archive; amount/count/date/posted-state and missing-row
  findings for that plan are manual review issues
- never directly mutate a statement archive's financial/lifecycle fields or
  delete archived rows; canonical payment/reset RPCs carry narrow user/card/
  statement-bound contexts that database triggers validate
- keep bulk fix tolerant of partial success by preserving undo entries
- reload data after success or failure

Avoid hiding schema/RPC drift. If a missing migration makes a fix impossible,
surface the error clearly rather than silently skipping a broken invariant.

JSON backup restores user-owned finance/support rows including card aliases,
dismissed upcoming items, push subscriptions, wishlist items, cash buckets, and
notification preferences. Export reads use immutable-PK keysets. Append-only
`card_ledger` / `account_ledger`, user-owned notification/SMS logs, and immutable
`card_current_settlements` are export-only; restoring cards creates honest opening
events instead of replaying history. Settlement-linked children that cannot be
safe without their parent are conservatively omitted/normalized in both v2 and
legacy Data Health v1 backup parsing. Unowned `sms_log`
diagnostics remain service-role-only and never enter a user's backup.

Restore parsing rejects non-array tables, non-object/keyless rows, and duplicate
row keys before the transactional reset starts. Row-by-row replay over REST is
still not one transaction; the UI safety-export remains the recovery path for a
later schema/type/FK insert failure. `reset_user_finance_data()` itself is one
auth.uid-bound transaction and clears newly added support rows plus owner operation
logs so restored IDs cannot inherit stale notification-dedupe state.
Current-settlement markers are normalized away because their immutable parent is
export-only. Historical archive markers are retained and same-user/same-card RLS
validated during replay; proving that such an INSERT came from restore rather than
a direct client requires the future transactional restore protocol.
The lower-level clean-import reset deletes only non-paid/open working scope and
fails before mutation when immutable current-settlement or paid-statement
installment history would require reconstructing a historical plan.

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
