# Data Health Architecture Note

Last reviewed: 2026-08-03

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
  modal wiring, and legacy browser-dismissal migration
- `DataHealth.logic.ts`: thin pure issue orchestrator, issue/view-model and undo
  types, and shared date helpers
- `DataHealth.checks.ts`: domain-specific pure issue detection, including card
  scheduled-debt gap and partial-overlap checks
- `DataHealthPage.actions.ts`: primary-action authorization, safe-repair RPC
  execution, guarded technical writes, and undo capture where available
- `DataHealth.resolution.ts`: exhaustive policy for every issue kind; assigns
  automatic, guarded, guided-domain, manual-reconciliation, or informational
  resolution and its primary action
- `DataHealthPage.components.tsx`: issue cards, stats, and confirmation modals
- `DataHealthCardExpenseReview.tsx`: concrete duplicate comparison and missing
  description/category editor for the exact `payload.ids` candidates
- `src/hooks/useFinancePaymentDrawer.ts` and
  `src/components/finance/FinancePaymentDrawer.tsx`: guided payment actions for
  issues such as overdue open card statements
- `src/data/repositories/dataHealthRepo.ts`: immutable-PK keyset table reads,
  optimistic singleton writes, account-wide issue acknowledgements, and reset RPC
- `src/services/dataHealthRepairs.ts`: typed client for the transactional safe
  repair RPC and its persistent receipt
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
3. `resolveHealthIssue(issue)` assigns one explicit resolution mode and primary
   action. Every emitted issue has either a real fix/payment/review action and a
   route to its owning area; legacy `fixable` alone never exposes a write button.
4. `HealthIssueCard` presents the issue, source of truth, preview, and action.
5. Guided actions that are normal domain operations (for example paying an
   overdue open statement) should open the shared domain drawer instead of
   inventing a Data Health-only write path.
6. Ambiguous issues expose a concrete owner/reconciliation action. Duplicate
   candidates can be compared in place and a user-confirmed duplicate is
   reversed through `cancel_card_expense`; flagged metadata rows are edited by
   exact ID through a non-financial guarded RPC.
7. Bulk repair submits only deterministic card/account projections and the card
   split clamp to `apply_data_health_safe_repairs`. The server validates the
   entire optimistic snapshot under locks before any mutation and returns an
   immutable run/step receipt. `loanTotals` uses the same RPC as an individual
   one-item loan-domain plan but is deliberately not bulk-eligible, so card and
   loan lock domains are never mixed.
8. `data_health_repair_runs` binds the canonical request to its idempotency key;
   `data_health_repair_steps` stores per-target before/after results. Authenticated
   clients can read only their own receipts and cannot mutate either table.
9. “Bu doğru, kapat” stores the exact issue ID in
   `data_health_issue_acknowledgements`. The acknowledgement is user-scoped,
   reversible, and shared by every signed-in device; it never changes finance
   rows. Legacy `datahealth:dismissed` browser IDs are migrated once through the
   same auth-bound RPC and then removed from localStorage.
10. `loadData()` refreshes the page after every write or failure.

Do not add a write action without a source of truth, stale-data guard, and an
explicit resolution policy. If a finding can only be resolved with bank/user
truth, keep it guided/manual and provide the exact next action instead of
inventing a value.

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
  `card_expenses.transaction_fingerprint`; explicit different installment
  numbers (`1.Tk`/`2.Tk`) and charge components (`anapara`/`faiz`/`BSMV`/`KKDF`)
  prove distinct bank rows and are excluded from loose duplicate candidates
- authoritative PDF carryover plans may omit every historical installment row;
  `card_expenses.note` records how many installments were completed before the
  open plan, so Data Health expects only the current/future suffix rather than
  reporting intentional history as missing
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

- capture only the fields touched by a guarded singleton update and bind session
  undo to the exact post-fix `updated_at`; if the row changes afterward, abort
  undo rather than overwriting a newer domain edit. Deterministic RPC
  recomputations rely on their immutable server receipt instead of session undo
- update only the affected table and IDs
- use repository helpers for direct table writes
- use service/RPC helpers for ledger recomputation
- authenticated clients have no direct INSERT grant/policy on `card_ledger` or
  `account_ledger`; authority events remain trigger/correction-RPC owned
- safe-repair plans contain 1..100 entries, are duplicate-free, bound to their
  idempotency key, single-domain, user-serialized against full reset, and
  all-or-none on a stale target. The UI previews only the first 100 repairs as
  one atomic transaction and explicitly leaves any remainder for a fresh next
  preview; it never silently truncates a submitted preview
- never write aggregate card debt from scheduled-debt gap/overlap or installment
  overflow warnings; those issues are intentionally non-fixable
- never auto-rewrite installment structure through REST. Amount/count/date/
  posted-state and missing-row findings navigate to the canonical card-plan edit
  flow, which owns parent/sibling locks and rebuild rules. Historical or allocated
  plans remain manual reconciliation.
- never directly mutate a statement archive's financial/lifecycle fields or
  delete archived rows; canonical payment/reset RPCs carry narrow user/card/
  statement-bound contexts that database triggers validate
- never continue a bulk repair after a conflict; the server rolls back the whole
  submitted domain plan and records the conflict receipt
- reload data after success or failure

Avoid hiding schema/RPC drift. If a missing migration makes a fix impossible,
surface the error clearly rather than silently skipping a broken invariant.

JSON backup restores user-owned finance/support rows including card aliases,
dismissed upcoming items, Data Health issue acknowledgements, push subscriptions,
wishlist items, cash buckets, and notification preferences. Export reads use
immutable-PK keysets. Acknowledgements are replayed through their auth-bound RPC,
not by granting direct table writes. Append-only
`card_ledger` / `account_ledger`, `data_health_repair_runs` /
`data_health_repair_steps`, user-owned notification/SMS logs, and immutable
`card_current_settlements` are export-only;
restoring cards creates honest opening events instead of replaying history.
Settlement-linked children that cannot be
safe without their parent are conservatively omitted/normalized in both v2 and
legacy Data Health v1 backup parsing. Unowned `sms_log`
diagnostics remain service-role-only and never enter a user's backup.

Restore parsing rejects non-array tables, non-object/keyless rows, and duplicate
row keys before the transactional reset starts. Row-by-row replay over REST is
still not one transaction; the UI safety-export remains the recovery path for a
later schema/type/FK insert failure. `reset_user_finance_data()` itself is one
auth.uid-bound transaction and clears repair receipts, newly added support rows,
and owner operation logs so restored IDs cannot inherit stale repair keys or
notification-dedupe state.
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
npm run db:test:data-health-safe-repairs
npm run lint
npm run test:unit
npm run build
```

For repository, RPC, RLS, or migration changes, also run local Supabase reset,
lint, and RLS audit checks when available.
