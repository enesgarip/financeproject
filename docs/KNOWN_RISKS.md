# Known Risks

## 1. Encoding / Mojibake (mitigated)

A repo-wide scan on 2026-06-05 found **no** UTF-8 mojibake in `src`, `docs`, the SQL migrations, or `README.md` — Turkish characters render correctly. The audit was repeated on 2026-06-15 with the encoding guard plus a manual signature scan across 305 source/doc/migration files; no mojibake signatures were found. Earlier reports were most likely a terminal display artifact rather than corrupted bytes.

A regression guard now runs in CI: `src/utils/encoding.guard.test.ts` (part of `npm run test:unit`) reads every source/doc/migration file via Vite's `?raw` glob and fails if the tell-tale mojibake digraphs (the garbled two-character forms Turkish letters degrade into) or the Unicode replacement character reappear. The guard file itself lists the exact signatures and is the only file excluded from the scan.

Residual risk is low: keep editors and tooling on UTF-8.

## 2. Domain Logic Concentration in Large Page Files (mitigated)

All four original large page files have been split into focused modules. The last
remaining monolith (`DataHealth.logic.ts`, 1413 lines) was split into a thin
orchestrator (~160 lines) and `DataHealth.checks.ts` (domain check functions,
since grown to ~1730 lines as new checks were added). The largest page files as
of 2026-08-12 are `CarsPage.tsx` (~780 lines), `AssetsPage.tsx` (~770 lines),
`DataHealthPage.tsx` (~650 lines), `CardsPage.expense.tsx` (~570 lines), and
`LoansPage.tsx` (~520 lines).

Residual risk: `DataHealth.checks.ts` is still the largest single logic file, but
each check function is self-contained and independently testable.

## 3. Frontend Assumes Certain Migrations/RPCs Already Exist (mitigated)

The code still detects missing schema cache / missing function cases, but the
highest-risk paths now fail visibly instead of silently degrading:

- user-visible actions use `missingSupabaseCapabilityMessage`
- retired RPC signatures are not retried as hidden compatibility paths
- app-start/card-page maintenance surfaces missing maintenance RPC deployment
- ledger and live-reconciliation panels show migration-drift warnings when
  their tables are absent

Remaining allowed fallbacks are intentionally narrow: Analysis reports optional
missing tables through `SchemaMigrationNotice`, and backup/restore skips tables
that are not deployed in the target environment.

User backups include support tables added after the original backup feature:
card aliases, dismissals, push subscriptions, wishlist items, cash buckets, and
notification preferences are restorable. User-owned SMS/notification logs, both
ledgers, and immutable current-settlement evidence are audit exports only. Ledgers
restart with opening events after restore. Ownerless raw SMS diagnostics are
service-role-only, never user-readable.

Backup and Data Health use immutable-PK keyset pagination, so they no longer rely
on PostgREST's implicit 1000-row cap or offset boundaries. Multiple pages/tables
are still not a transaction snapshot: concurrent inserts/deletes may change export
membership. Do not describe a live export as point-in-time consistent.

## 4. Card Debt Math Has Multiple Derived Fields (mitigated)

Credit card debt depends on several related fields (`debt_amount`,
`statement_debt_amount`, `current_period_spending`, `provision_amount`,
scheduled installments). Three layers now prevent inconsistency:

1. **DB triggers**: `clamp_card_breakdown` BEFORE trigger enforces
   split ≤ debt on every write; `record_card_debt_event` AFTER trigger
   appends every change to the append-only `card_ledger`. Child allocation
   triggers prevent direct existing-row NULL→settlement/archive reassignment;
   only canonical payment/statement RPC contexts can attach existing rows.
   Historical archive-marker INSERT stays restore-compatible under same-user/
   same-card RLS until restore becomes transactional. The expense edit RPC
   rejects both directly archived expenses and installment parents with any
   archived child, so current-period reversal logic cannot rewrite statement rows.
   Trigger-level field guards also reject raw REST amount/date/card/plan edits on
   archived expense/installment rows. Archive parent financial/lifecycle fields,
   archived lifecycle updates, and archived plan DELETEs are also guarded while
   canonical statement payment may perform the exact open→paid transition.
   Statement installment amount mismatches are
   review-only; changing one child without parent/card/ledger effects is unsafe.
2. **DataHealth checks**: `checkCards` detects split inconsistency,
   scheduled-debt gaps, partial scheduled overlap, installment overflow, and
   unclassified debt; `checkLedgerDrift` catches ledger projection ≠ stored debt.
   Ambiguous scheduled composition issues are non-fixable and never overwrite
   aggregate debt without bank truth.
3. **Unit tests**: `clampCardBreakdown`, `cardDebtBreakdown`,
   `buildCreditLimitGroups`, and DataHealth card-drift checks are all
   tested in `financeSummary.test.ts` and `DataHealth.logic.test.ts`.

## 5. Mixed Loan Model (mitigated)

The dashboard supports both explicit `loan_installments` and legacy
`loan.monthly_payment` fallback. This is intentional: loans without an
installment plan still need to appear in cash-flow projections.

The fallback is clearly labeled: `obligations.ts` tags legacy rows as
`kind: 'legacy_loan_installment'` with `isEstimate: true`, and
`financeSummary.ts` only uses `monthly_payment` for loans not covered by
`loan_installments`. DataHealth `checkLoans` flags loans that have no plan
and nudges the user to create one.

No duplicate counting risk remains: the `plannedLoanIds` set ensures a
loan is counted via exactly one path.

## 6. Data Health Page Is Operationally Powerful (mitigated)

`DataHealthPage` can apply deterministic repairs, guarded technical fixes,
guided domain actions, and full user reset. Four safety layers exist:

1. **Exhaustive resolution policy**: every emitted issue is assigned a source of
   truth and a real fix/payment/review/owner action. Ambiguous bank truth never
   becomes an automatic amount/date/payment write.
2. **Transactional safe-repair boundary**: deterministic card/account plans and
   individual loan-domain repairs validate all targets under lock before
   mutation, reject stale whole plans, bind idempotency keys to canonical
   requests, and append immutable own-row run/step receipts.
3. **Export backup**: JSON and CSV data export is available before any
   bulk operation; the "reset all data" flow takes an automatic JSON
   backup before calling the destructive RPC.
4. **Test suite**: unit/UI tests cover policy/action wiring and a real Postgres
   regression covers grants, RLS, source projections, stale rollback,
   idempotency, prevalidation, and audit visibility in CI/deploy.

Structural installment amount/count/date/posted-state and missing-row findings
never use generic REST repair writes. They navigate to the canonical card-plan
editor, where parent/sibling locks and lifecycle guards own the rebuild;
historical/allocated plans remain manual reconciliation. Exact duplicate
candidates have an in-page side-by-side choice and use append-only domain
cancellation, while missing metadata uses an owner/stale-guarded non-financial
RPC that does not change archived financial totals.

Guarded technical fixes keep a session-only field snapshot. Undo patches only
those fields and requires the exact post-fix row version; any intervening edit
causes a visible conflict instead of a full-row overwrite. Bulk previews mirror
the server's 100-repair cap and disclose repairs deferred to a fresh next turn.

Restore validates table arrays, plain row objects, immutable keys, and duplicate
keys before reset. It does not yet validate every column type/enum/FK against a
runtime schema, and row replay over REST is non-transactional. The automatic
safety export makes a later insert failure recoverable, but a future restore
protocol should be a single transactional server operation for atomicity.
Historical statement-linked children must currently retain their archive marker
during direct REST replay. RLS verifies that marker's parent belongs to the same
user and card, but direct same-card INSERT provenance cannot be distinguished from
a genuine restore until replay moves into that transactional server operation.

## 7. Limited Safety Net from Tests (mitigated)

A Vitest unit suite now covers the core pure finance utilities — statement period math (`cardStatement`), budget alerts (`budgetAlerts`), savings-goal progress (`savingsGoal`), live valuation (`valuation`), market-rate parsing (`marketRates`), category inference (`categories`), last-used memory (`lastUsed`), card installment calendar (`cardInstallmentCalendar`), statement reminders (`statementReminder`), and financial summary aggregations (`financeSummary`) — and runs in CI via `npm run test:unit`.

DataHealth check logic is tested in `DataHealth.logic.test.ts`. The remaining
uncovered areas are mainly page-component UI side effects. Supabase money RPC
invariants that need a real database are exercised by SQL regressions under
`supabase/tests/`, including provision transitions, complete reset, guarded child
allocation, and card/account source-event idempotency; Playwright
and targeted local-Docker verification cover the remaining flow boundary.

## 8. Shared Credit Limit Semantics (mitigated)

Limit grouping uses `limit_group_name` and treats group limit as the
**maximum** card limit in the group, not the sum — this matches how Turkish
banks expose a shared limit across multiple cards. The rule is documented
with a code comment in `financeSummary.ts` (`buildCreditLimitGroups`) and
tested in `financeSummary.test.ts` with dedicated `describe` blocks covering
shared-limit grouping and multi-card scenarios. DataHealth `checkCards` also
detects over-limit groups at runtime.

## 9. Turkish Search Normalization (mitigated)

Filtering/matching text with `toLocaleLowerCase('tr-TR')` can miss all-caps bank or merchant names such as `MIGROS`, `BIM`, and `IS BANKASI` because plain ASCII `I` lowercases to dotless `ı`.

Use `src/utils/searchText.ts` for search/filter keys. The 2026-06-16 component audit moved shared CRUD search, quick actions, dashboard history search, Analysis export search, category inference, bank branding, and card bank-name normalization onto that helper.

## 10. SMS Identity Without A Provider Message ID (partially mitigated)

`parse-sms` accepts a stable source identity through body `eventId` or the
`x-source-event-id` header. Callers should send the device/provider's immutable
message ID when available. For backward compatibility, callers that send only
the SMS text fall back to a normalized raw-message SHA-256. This safely absorbs
network retries, and bank transaction timestamps normally distinguish consecutive
transactions. However, two byte-identical legitimate bank SMS messages (including
the same second) are fundamentally indistinguishable without an external message
ID and would share the fallback identity. Minute-precision account SMS messages
have a materially higher collision risk, so `parse-sms` rejects them unless the
caller supplies a stable `eventId`/`x-source-event-id`. Do not remove caller-supplied
ID support or re-enable content-hash finance writes for minute-only account events.
