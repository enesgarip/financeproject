# Finance Rules

Last reviewed: 2026-08-12

## Scope

This file records the current business rules inferred from the codebase. If code and this file diverge, update both intentionally.

## Money and Formatting

- Monetary values are stored as exact `numeric` in the database; float issues exist only in JS. Ledger tables store signed integer kuruş (`amount_kurus bigint`).
- All money rounding/comparison goes through `src/utils/money.ts`: `roundTL`, `equalsTL`, `moneyDiffers`, `greaterThanTL`, `diffTL`, `toKurus`/`toTL`, `sumTL`. These compare at kuruş precision after rounding.
- Ad hoc tolerances are FORBIDDEN: do not write bare `Math.round(x*100)/100` or a `±0.01` comparison tolerance. If two amounts should be "equal", use `equalsTL`/`moneyDiffers`; import-matching tolerances have their own dedicated owner (`src/utils/importMatch.ts`).
- Amounts are displayed in Turkish locale.

## Assets

- Cash assets use category `Nakit`.
- Asset estimated worth is normalized into TRY with `estimated_value_try`.
- Non-TRY assets may still be represented through an estimated TRY value for summaries.
- Existing assets can be bought or sold from the Assets page through
  `trade_asset_with_account`.
  - Buy requires a selected `banka_karti`, debits that account, and increases the
    asset's TRY value. If quantity is supplied, the asset amount also increases.
  - Sell requires a selected `banka_karti`, credits that account, and decreases
    the asset's TRY value. If quantity is supplied, the asset amount also
    decreases.
  - Stock (`Hisse`), fund (`Fon`), and non-TRY cash trades require quantity so
    the source holding amount moves with the bank-account cash leg. This is
    mandatory for auto-valued FX because the next rate sync derives value from
    `amount`.
  - Ledger-managed gold asset rows stay outside this flow; gold is managed from
    the Gold page/ledger.

## Market Rates & Auto-Valuation

Gold and foreign-currency holdings, debts, and savings goals can derive their
TRY value from live market rates instead of a hand-typed `estimated_value_try`.

- Rate source: public truncgil v4 feed (`USD`, `EUR`, `GBP`, `GRA` = gram gold,
  `CEYREKALTIN` = quarter gold), fetched client-side on app open and via a manual
  "Yenile" button. The feed sometimes truncates its long JSON tail, so the parser
  (`src/utils/marketRates.ts`) falls back to tolerant per-symbol extraction.
- The `auto_valued` flag (on `assets`, `debts`, `savings_goals`) records opt-in.
  Only auto-valued rows are recomputed; existing manual rows are never overwritten.
- Quantity is the source of truth: gold uses `amount` (gram/piece), FX uses the
  foreign `amount`. `estimated_value_try` is a cached projection refreshed on each
  rate load (`syncAutoValuedRows`) so dashboard, summaries, and settlement RPCs
  keep reading an up-to-date stored value.
- Valuation side: holdings and receivables use the buying price (Alış); obligations
  you owe (`borç_aldım`, gold/FX debts) use the selling price (Satış).
- Symbol mapping: asset gold `unit='gram' → GRA`, `unit='adet' → CEYREKALTIN`;
  cash/`doviz` use the currency code; debt `gram_altin → GRA`,
  `ceyrek_altin → CEYREKALTIN`.
- If a rate is missing or the feed is offline, the stored `estimated_value_try`
  is used as a fallback.

## Expense Contexts and Cars

- Araç, evcil hayvan ve etkinlik/proje satırları saf raporlama annotation'ıdır; ledger, kart borcu, net değer veya nakit akışı yazmaz.
- Kartla ödenen gerçek gider `card_expenses` içinde kalır ve yalnız `car_id` veya `context_id` ile etiketlenir. Kart-dışı gerçek gider ilgili manuel tabloda tutulur; aynı gider iki kaynağa birden girilmez.
- Yakıt tüketimi ardışık kilometreli dolumlar arasında full-to-full ölçülür. İlk kilometreli dolum baz noktasıdır; tek başına tüketim üretmez.
- Araç TCO'su birleşik gider merceğinin takvim-yılı toplamıdır; günlük maliyet yıl içinde geçen gün sayısına bölünür.
- Hatırlatıcı tamamlandığında tekrar aralığı varsa hedef ileri taşınır; yoksa aktif listeden kaldırılır. Bu işlem finans geçmişini değiştirmez.

## Cards: Core Model

Detailed field transitions are documented in `docs/CARD_DEBT_TRANSITIONS.md`.
Treat that file as the card-debt mutation source of truth when changing card
RPCs, page actions, dashboard math, or data-health checks.

Credit card debt is conceptually split into visible payable/planning parts:

- `statement_debt_amount`: already billed, payable amount
- `current_period_spending`: posted spending in the current period but not yet statemented
- `provision_amount`: pending/provisional spending
- scheduled future installment amount: future credit-card installment planning

Current code expects:

`debt_amount >= statement_debt_amount + current_period_spending + provision_amount`

When there are scheduled future card installments, the expected difference is the future installment amount. The future installment rows are planning rows inside card debt; they must not be added as a second independent debt bucket.

This relationship appears in both card page logic and dashboard/data-health checks.

Bank “current debt” and app total card debt are not interchangeable. A bank may
show current debt as zero after payment while future installments remain. Bank
snapshot reconciliation therefore uses the total remaining card burden including
future installments, changes only `debt_amount`, and leaves the statement,
current-period, and provision buckets intact. Recording the actual payment is a
separate action tied to the bank account that funded it.

If an old aggregate card payment left posted rows without a settlement marker,
a later full current-period payment may classify the historical excess without
another cash movement. This is allowed only when the excess exactly equals all
unallocated rows before the active statement-cycle start; otherwise payment is
rejected and nothing changes.

## Shared Credit Limits

- Cards may share a limit through `limit_group_name`.
- Group limit is treated as the max `credit_limit` among cards in the same group, not the sum.
- Group debt is the sum of grouped cards' `debt_amount`.

## Card Statement Rules

From `src/utils/cardStatement.ts`:

- statement logic applies only to `kredi_karti`
- `statement_day` and `due_day` are required for statement-derived calculations
- statement date is the next statement day on or after transaction date
- period start is the day after the previous statement date
- period end is the statement date
- due date may fall in the same month or next month depending on `due_day <= statement_day`

Statement archive behavior:

- `card_statement_archives` tracks a monthly card statement with `period_year`, `period_month`, and `status`
- one user/card/month can have only one statement archive
- statement status is `open` until paid, then `paid`
- `cut_card_statement` is idempotent for one user/card/month
- statement amount is the posted current-period spending at cut time
- cutting a statement links posted card expenses and posted card installments through `statement_archive_id`
- statements are cut automatically the day **after** the statement day (like banks), so the statement day's own spending is included; the dashboard/cards page calls `cut_due_card_statements` on load and the daily `pg_cron` job runs it server-side. There is no manual "cut statement" action.
- statement/current movement imports match existing app expenses primarily by amount and same-or-near date, not by identical merchant text. Matching tuning lives in one shared owner, `src/utils/importMatch.ts`: the amount tolerance is `max(5 TL, 1%)` of the larger amount, the near date window is 3 days, and the loose window extends to 7 days where a match additionally REQUIRES compatible descriptions (blind amount-only matching is allowed only in the near window with a single candidate). This lets the user keep personal descriptions while avoiding duplicate imports when bank posting dates drift by a few days.

## Scheduled Card Maintenance (server-side)

A daily `pg_cron` job runs `run_scheduled_card_maintenance()` so time-based card
transitions happen on the correct day even if the app is never opened.

- It impersonates each credit-card user (sets the JWT `sub` claim) and calls the
  existing, audited RPCs — `post_due_card_installments`,
  `cut_due_card_statements`, and `post_card_provision` — so there is no
  duplicated money logic.
- Statement cutting is idempotent (one archive per user/card/month); the client
  still calls `cut_due_card_statements` on app open as an immediate fallback.
- Scheduled card installments keep the transaction day as their due date. They
  become `current_period_spending` only after that exact date passes. Maintenance
  posts due rows before statement cutting; the statement cut then bills rows on
  or before the boundary and leaves later due dates in the new period.
- Provisions still pending after a threshold (default 7 days) are treated as
  cleared and posted into the current period. This is the one transition that
  mutates state on an assumption; it is logged to `transaction_history`.
- The function is intentionally **not** granted to `authenticated` (it would let
  one user trigger maintenance for everyone); only the scheduler runs it.

## Card Payment Rules

On the cards page:

- payable card debt excludes provision and future scheduled installments:
  - `payableDebt = max(0, statement_debt_amount + current_period_spending)`
- user should not pay more than payable posted debt
- provision must post before it becomes payable debt
- card debt payments must debit a `banka_karti` source account
- the preferred credit-card payment flow is paying an open statement with `pay_card_statement`
- statement payment debits a `banka_karti`, uses the archived statement amount,
  reduces card debt, and marks only the statement paid; linked installment rows
  remain a schedule and are not mutated by payment
- direct card debt payment is legacy/manual behavior and should not be the primary installment flow

## Card Expense Rules

- card expenses can be `provision`, `posted`, or `cancelled`
- cancelled expenses should not count toward budget alerts
- installment expense creation may generate `card_installments`
- single-installment data is treated differently from multi-installment planning and is checked in data health
- `card_expenses.transaction_fingerprint` is generated from card, date, amount,
  normalized description, and status. It is a coarse similarity signal for import
  reconciliation and Data Health, never proof of a duplicate and never a uniqueness
  key; it must not change card debt or ledger balances by itself.
- `card_expenses.source_event_id`, namespaced by user and `source`, is the retry
  idempotency key. Reusing it returns the existing expense without repeating card,
  installment, ledger, payment, or transaction-history effects. Different event IDs
  remain separate even when every fingerprint field is identical.
- Credit-card-funded `bank_auto` payments and their bank SMS are one financial
  event. A unique same-card/near-date/tolerant-amount plan match advances the
  payment and creates only the SMS expense. The automatic poster waits through
  the due date and is a next-day fallback; a late SMS attaches to that fallback
  expense without increasing card debt again. Ambiguous candidates stay separate
  for review instead of being guessed.
- Data Health reports same-fingerprint card expenses and possible
  duplicates by same card/date/status/amount plus similar or blank descriptions.
  These are review signals, never automatic deletes. The user compares the exact
  candidate IDs; a confirmed duplicate is reversed by the canonical
  `cancel_card_expense` domain transition.

Current movement reconciliation:

- DenizBank internet-banking movement PDFs are an intra-period reconciliation source, not a statement cut.
- The movement export has two column layouts. `Kart No` / `Kart Tipi` appear only
  when the card has linked supplementary or virtual cards; a single-card product
  omits both columns entirely. Parsing treats them as optional, so `cardNo`,
  `cardType`, and `cardLastFour` can be empty. They are display-only detail: the
  target card comes from the import screen selection, never from the row.
- `Bekleyen İşlem` rows import as `provision`; `Dönem İçi` spending rows import as `posted`.
- `Hesaptan Ödeme` rows are not imported as card expenses.
- `Taksitli Satış` rows are matched to existing installment rows by amount,
  installment number, derived exact date, and description. Unmatched rows can
  be selected after the user enters the total installment count; the importer
  then creates a first-installment plan or a mid-plan carryover without
  renumbering the bank's installment sequence.
- Review screens show the app's spending history for the detected period, keep matched bank/app record pairs collapsed by default, and leave missing rows unselected until the user chooses which rows to import.
- Importable rows are selected by a stable per-row key instead of array position,
  so identical-looking bank rows can be selected one by one.
- Import writes use PDF text hash + canonical row-content hash + same-content
  occurrence ordinal as `source_event_id`. Reimporting one source row is idempotent,
  while two identical rows in the same PDF have different occurrences and remain two
  legitimate transactions; reordering non-identical parser output does not change IDs.
- A current-movement PDF is transaction evidence, not an independent total-debt
  snapshot. Rebuilding the open period from it must not record a synthetic
  zero-drift debt reconciliation; "bankayla mutabık" requires a real bank amount.
- Statement PDF import is an authoritative, atomic replacement through the PDF's
  statement date. All validated rows are included; unknown installment counts
  must be confirmed first. Paid/current-settled evidence and movements after the
  statement date are preserved. Current-movement import remains non-destructive
  matching because it does not contain an independent total-debt snapshot.
- Imports use `add_card_expense` for ordinary card spending so card debt, provision/current-period fields, ledger events, and transaction history stay under the audited mutation path.
- If a missing bank row matches a still-open planned payment by amount and due/movement date, the import uses `pay_payment_from_card_import` instead. This creates the card expense on the bank row date and advances/closes the planned payment, preventing the same bill from remaining as a separate pending obligation.
- DenizBank statement installment rows show the original purchase date even for
  later installments. Import derives the current installment due date as
  `original date + (installment_no - 1 months)` before creating carryover or
  clean-import installment rows; otherwise future installments can be pulled into
  the current statement too early.

## Card Installment Rules

From `src/utils/cardInstallmentCalendar.ts` and page logic:

- scheduled installments are summarized by `due_month`; the column name is
  legacy, and the value is now the exact installment due date rather than always
  the first day of the month
- installment calendar defaults to upcoming months from the current month
- only `scheduled` installments count in scheduled-total style calculations
- `posted` installments represent already-posted/consumed rows after their due
  date has passed
- when a multi-installment card expense is created or a provision is posted, only
  installment rows whose exact due date is on/before today are posted immediately;
  later rows stay scheduled
- credit-card installments are not separate debt
- the unpaid installment total is informational/planning data and must not be added on top of card debt
- posted installments become payable as part of the card statement
- paying the linked statement closes only the statement archive; installment
  rows remain an informational schedule and are not mutated by payment
- paying the full current-period balance before statement cut records a
  `card_current_settlements` allocation, marks due posted installments `paid`,
  and prevents the allocated movements from entering a later statement;
  future scheduled installments remain scheduled
- credit-card installments are not manually paid; manual payment is limited to the card's statement/current-period debt
- locked installments, meaning paid or linked to a statement, should not be edited from the UI
- during authoritative statement replacement, the PDF creates only the
  current/future open-plan suffix and records the completed prefix in the
  parent note; synthetic paid history is not recreated. Since K1
  (`20260810130000_statement_import_reuse_plan.sql`), the server-side carryover
  path reuses an existing preserved parent when exactly one same-card parent
  matches by installment count, identical description, and paid/settled
  history; otherwise a new parent is created.
- Data Health checks that each linked installment date equals the original
  transaction date plus `(installment_no - 1)` months; legacy first-of-month
  dates and other structural plan drift navigate to the canonical parent-plan
  editor. Generic REST writes must not mutate child amount/count/date/lifecycle
  or invent missing historical rows without parent/sibling locks and bank truth.

## Bank Account / Transfer Rules

- `cards.card_type = 'banka_karti'` represents a bank account balance in the app.
- Authenticated clients cannot insert directly into `card_ledger` or
  `account_ledger`; signed kuruş authority is trigger/correction-RPC owned.
- Manual account inflow/outflow updates one account balance and writes `transaction_history`.
- Bank-to-bank transfer uses `transfer_between_accounts`:
  - source and target must both be `banka_karti`
  - source and target cannot be the same account
  - source balance must be enough for the transfer amount
  - source balance decreases, target balance increases, and one `transfer` history row is written

## Transaction History Rules

Detailed history side effects are documented in `docs/TRANSACTION_HISTORY.md`.
Treat `transaction_history` as the user-facing activity feed, not the accounting
source of truth. Balance/card-debt invariants come from ledger tables, card
fields, statement archives, and trigger/RPC rules. New finance mutations should
write history in the same database transaction as the state change, with the
public RPC owning the feed row.

## Budget Alert Rules

From `src/utils/budgetAlerts.ts`:

- budget alerts are month-based
- alerts compare monthly budget rows to active card expenses in the same month
- cancelled card expenses are ignored
- status rules:
  - `over` if spent exceeds limit by more than `0.01`
  - `warning` if usage is at least `80%`
  - `ok` otherwise
- UI-relevant alert list currently filters out `ok`

## Payments

- payments can be one-off or monthly recurring
- recurrence types currently include `none` and `monthly`
- payment status is mainly `bekliyor` or `ödendi`
- marking a payment paid can use a bank card or credit card:
  - bank cards decrease `current_balance`
  - credit cards create a posted `card_expenses` row and increase `debt_amount` plus `current_period_spending`
- DenizBank statement/current movement imports can reconcile a card-paid planned payment through `pay_payment_from_card_import`; this is credit-card-funded payment semantics with the bank import date preserved on the generated expense.
- `src/utils/financeObligationRules.ts` owns the small shared helpers for payment
  occurrence and cash impact; both monthly cash-flow and dated obligation
  projections use those helpers.
- A payment instructed to a credit card (BM-5 "bilgilendirme modu":
  `payment_method = 'bank_auto'` with a selected `auto_source_card_id`,
  `paymentUsesCreditCard`) is informational for cash flow: its cash impact for
  the month is 0 (`paymentCashOutflowAmount`), because the money leaves as card
  debt, and the real bank outflow happens when that card's statement is paid.
  Its nominal amount still exists as a liability (see below).
  This informational treatment applies only when the source card is a CREDIT
  card: when the caller supplies the card list (`buildCreditCardIdCheck`) and
  the `auto_source_card_id` points to a bank account, the payment counts as a
  normal cash outflow (Faz D, 2026-08-12). Without a card list the old
  assumption (source = credit card) is kept.
- dashboard monthly load includes:
  - one-off payments due in the month
  - recurring monthly payments whose occurrence lands in the month
- monthly cash-flow summaries derive payment/card/loan/debt buckets from the
  normalized obligation projection. Card statement debt is counted when payable;
  current-period card spending is counted on the open period's statement due date
  — derived from the card's statement period when no statement is pending
  (`statement_debt = 0` and no open archive), or the cycle after when a statement
  is already pending (so the pending statement and the open period never collide).
  If the statement day has passed and that statement was paid early, the old due
  date is not reused for new current-period spending; the spending moves to the
  next cycle's due date. Scheduled card installments remain a card load, not an
  immediate bank-cash outflow.
- UI labels must preserve the same split: "Nakit çıkışı" / "Kart ödemesi"
  means bank cash impact, while "Kart harcaması" means card consumption on
  `card_expenses.spent_at`. Do not merge them into one "gider" bucket or card
  spending will either look missing or be counted twice when the statement is paid.
- The payments-page planned-load calendar also summarizes by obligation cash
  impact. Card-funded automatic payments and scheduled card installments can
  appear on their calendar date as card load, but they must not increase "Ay
  yuku" or "Net etki" cash totals.
- Balance-sheet liabilities include every pending one-off payment at its nominal
  amount, including card-funded ones. Funding method changes cash timing, not the
  existence of the liability. Monthly recurring payments remain cash-flow load.
- Payments-page monthly paid counts come from `transaction_history` rows whose
  source is `payments`; a recurring row merely having advanced into next month is
  not proof that it was paid in the current month.

## Salary

- `salary_history` records the monthly net salary amount that becomes effective
  on `effective_date`; it is not a one-off deposit history.
- Monthly cash-flow summaries count one salary income for the target month using
  the salary record effective by that month's end.
- Forward cash projections repeat the salary each month until a newer effective
  salary record applies. A future salary record does not affect earlier months.
- "Current salary" consumers (`getCurrentSalary`) also require
  `effective_date <= today`; an all-future salary history has no current salary.
- Salary trend comparison (`getSalaryTrend`) is consumed only by the Salary
  page (`/varliklar/maas`); the dashboard no longer shows it.
- The daily cash calendar shows upcoming obligations and cash impact; it does
  not create a daily salary deposit event from `salary_history`.

## Loans

- loans may be tracked with explicit `loan_installments`
- if explicit installment rows do not exist, dashboard logic falls back to legacy monthly summary fields on the loan row
- normal app flow should pay a loan installment through a selected `banka_karti` source account; it should not be marked paid as a visual-only action
- a loan should align with:
  - `remaining_amount`
  - `remaining_installments`
  - `status`
  - installment row state when installment rows exist
- Editing a loan schedule may rewrite or remove only pending installments.
  Already-paid installment due dates, amounts, payment metadata, and extra rows
  are historical facts and must be preserved.

## Loan Affordability (removed)

The loan-affordability calculator (`loanAffordability.ts`) was removed from the
app; there is no affordability decision surface anymore.

## Debts / Receivables

- `borç_aldım` behaves like money owed by the user
- `borç_verdim` behaves like receivable income
- debts may be TRY, FX, gram gold, or quarter gold in type
- summaries often use `estimated_value_try`
- open receivables are shown as expected collection and are not added to net worth until collected

## Savings Goals

Savings goals support:

- `TRY`
- `gram_altin`
- `ceyrek_altin`
- `composite`

Composite goal progress rule:

- progress is the average completion percentage of goal components
- if there are no components, progress is `0`

Non-composite goal progress rule:

- progress is `min(100, current_amount / target_amount * 100)` when target is positive

## Dashboard Planning Rules

Current dashboard (Şerit) behavior includes:

- the hero number is the "harcanabilir" figure (`buildSafeToSpend`: liquid cash
  + remaining income − remaining obligations − buffer − kasa reserve; the
  `reserved` input is mandatory, see `docs/DASHBOARD_ARCHITECTURE.md`)
- net worth equals assets minus card, loan, personal debt, and pending payment liabilities
- open receivables are shown separately as expected collection
- monthly cash projection and the month strip
- upcoming obligations within a lookahead window
- credit usage monitoring
- history grouping and filtering

The old dashboard panels for next-month load breakdown and salary trend
comparison were removed with the Şerit redesign; salary trend
(`getSalaryTrend`) now lives only on the Salary page.

This means any change in card, loan, debt, or payment semantics likely affects dashboard math.

## Reporting and projection windows

- The shared finance snapshot loads 24 completed months plus the current month,
  so current-year and previous-year reports have a complete source window.
- Removed features (their utilities no longer exist; do not resurrect their
  rules): full-month cash calendar (`fullMonthCalendar.ts`), FIRE projection
  (`fire.ts`), quiet-day spending (`quietDays.ts`).
