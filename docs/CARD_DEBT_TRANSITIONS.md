# Card Debt Transitions

Last reviewed: 2026-08-09

This file is the working source of truth for how credit-card debt moves through
the app. If an RPC, page action, or data-health fix changes one of these rules,
update this file in the same change.

## Canonical Fields

For `cards.card_type = 'kredi_karti'`:

- `debt_amount`: total card debt. This includes statement debt, posted current
  period spending, provisions, and future scheduled installment debt already
  created by the app.
- `statement_debt_amount`: billed/open-statement debt that is immediately due.
- `current_period_spending`: posted spending that has not been cut into a
  statement yet.
- `provision_amount`: provisional spending that uses limit but is not payable.
- `card_installments`: planning rows for installment timing. `due_month` is a
  legacy column name but now stores the exact installment due date, preserving
  the original transaction day when monthly installment rows are generated.
  These rows are inside card debt, not a second independent debt bucket.

The visible split must never exceed total debt:

```text
statement_debt_amount + current_period_spending + provision_amount <= debt_amount
```

The database trigger `clamp_card_breakdown()` enforces this on writes. Its
priority is statement first, then provision, then current period. The TypeScript
twin is `clampCardBreakdown()` in `src/utils/financeSummary.ts`.

> **2026-08-02 düzeltme (INC-01):** 20260625 migration'ı provizyonu geçici olarak
> `debt_amount`'tan ayırmıştı (`add_card_expense` provizyonda `debt += 0`), ancak
> `clamp_card_breakdown` hâlâ `statement + current + provision <= debt` istediği için
> boş/düşük-borç kartta provizyon clamp ile 0'a düşüp kayboluyor ya da current'ı
> yiyordu. Migration `20260802130000` bunu tersine çevirir: **provizyon yine toplam
> borcu artırır** (`add_card_expense` provizyonda `debt += amount`), `post_card_provision`
> ise posting'de borç EKLEMEZ (borç create'te eklendiği için yalnız `provision → current`
> taşınır). Böylece yukarıdaki matris + clamp tutarlı olur.

> **2026-08-02 prod follow-up:** `20260802160000_repair_legacy_provision_debt.sql`,
> yukarıdaki geçiş deploy edilmeden önce yaratılmış aktif provizyonlarda yalnız üç
> bağımsız projeksiyon aynı kuruş farkını doğrularsa toplam borca auditable ledger
> adjustment ekler. Belirsiz kartlar değiştirilmez. `20260802165000`, mutabakat
> akışındaki `cancel_card_expense` fonksiyonunu da yeni modele taşır: provision
> expense iptali hem toplam borcu hem provizyon kovasını tersler.

> **2026-08-02 allocation hardening:** `20260802190000`, child satırındaki
> `current_settlement_id` veya `statement_archive_id` alanının aynı karta ait eski
> bir parent id ile mevcut satırda doğrudan değiştirilmesini engeller. Bu
> NULL→parent UPDATE geçişlerini
> yalnız kartın aggregate kovalarını aynı transaction'da taşıyan `pay_card_debt` ve
> `cut_card_statement` yapabilir. Yetki bağlamı auth.uid, row owner, card ve parent'a
> bağlanır, iki child update'inden hemen sonra temizlenir ve SQL regresyonunda hem
> expense hem installment yolu doğrulanır.

> **Archived edit invariant:** `20260802200000`, `update_card_expense` çağrısını
> expense doğrudan bir statement archive'a bağlıysa veya taksit parent'ının herhangi
> bir child'ı archive'a girdiyse reddeder. Current-period edit algoritması arşivlenmiş
> tutarı yanlış kovadan tersleyemez; banka gerçeğinde düzeltme gerekiyorsa geçmiş
> satırı yeniden yazmak yerine auditable correction/reconciliation akışı kullanılır.
> Aynı invariant trigger'da da vardır: arşivlenmiş expense/installment'ın finansal
> kimlik alanları raw REST ile değiştirilemez. Ekstre ödemesi installment
> `status/paid_at` alanlarına artık dokunmaz; yalnız archive yaşam döngüsünü kapatır. Statement import'ta
> tek child tutarını parent/card/ledger etkisinden bağımsız değiştirmek güvenli
> olmadığı için amount mismatch yalnız manuel uzlaştırma sinyalidir.
> Archive parent'ın finans/lifecycle alanları ile arşivli child DELETE/status yolları
> da DB trigger ile korunur. Yalnız exact parent'a bağlı `pay_card_statement` veya
> user/card bağlı kanonik reset context'i geçebilir; arşivli expense iptali reddedilir.
> Backup restore uyumluluğu için yeni historical archive-marker INSERT same-user/
> same-card RLS kontrolünde kalır; mevcut satırı yeniden allocation etme yolu değildir.

## Display Helpers

Use `src/utils/financeSummary.ts` instead of reimplementing card math in pages:

- `cardProvisionAmount(card)`
- `cardSplitTotal(statementDebt, currentPeriod, provisionAmount)`
- `scheduledCardInstallmentTotalsByCard(installments)`
- `cardDebtBreakdown(card, scheduledTotal)`
- `cardPayableDebt(card)`
- `buildCreditLimitGroups(cards)`
- `clampCardBreakdown(debt, statement, current, provision)`

`buildCreditLimitGroups` is also the source for shared-limit semantics: group
limit is the max `credit_limit` in the group, while group debt is the sum of
member `debt_amount` values.

## Transition Matrix

| Action | Owner | Card field changes | Related rows |
| --- | --- | --- | --- |
| Posted expense added | `add_card_expense` | `debt_amount += amount`; `current_period_spending += installments whose due date has passed` | Inserts `card_expenses`; multi-installment expenses create exact-date installment rows, posting only rows due on/before today. A repeated non-null `(user, source, source_event_id)` returns the existing expense and repeats no effect. |
| Provision expense added | `add_card_expense` with `status='provision'` | `debt_amount += amount`; `provision_amount += amount` | Inserts a provision `card_expenses` row; no installment rows are created until posting |
| Provision installment count marked (pre-post) | `setProvisionInstallments` (repo direct update, no RPC) | none | Bank SMS carries only the total, so SMS provisions open with `installment_count=1`. Before posting, the provisions panel lets the user set the real count; this updates only `installment_count`/`installment_amount` on the `status='provision'` row. No debt/bucket/ledger change — it is a label the later `post_card_provision` reads to split the plan. The `status='provision'` filter forbids touching posted/archived rows (that path is `update_card_expense`). |
| Provision posted | `post_card_provision` | `provision_amount -= posted amount`; `current_period_spending += installments whose due date has passed` | Full post updates the same expense; partial post leaves the original provision with the remaining amount and inserts a posted expense; multi-installment posted provisions create exact-date installment rows |
| Provision cancelled | `cancel_card_provision` | `debt_amount -= amount`; `provision_amount -= amount` | Marks the expense `cancelled`; removes related installment rows if any |
| Unstatemented expense cancelled | `cancel_card_expense` | Single/provision rows: `debt_amount -= amount` (provision also reduces `provision_amount`). Posted multi-installment plans: `debt_amount -=` the plan's child-row total — the plan's actual debt contribution — so cancelling a carried-over plan (parent amount = full plan, debt contribution = remaining only) never over-reverses. Posted rows reduce current-period spending; future scheduled installment debt is removed without double-reducing current period. | Marks the expense `cancelled`, removes related installment rows, and logs a correction with the real reversal amount. Directly/child statement-archived expenses are rejected; historical corrections require append-only reconciliation. |
| Scheduled installment due date reached | `post_due_card_installments` / finance maintenance | `current_period_spending += due scheduled installment total`; `debt_amount` unchanged | Changes due `card_installments` from `scheduled` to `posted`; maintenance runs this before statement cutting, and statement cutting keeps posted installment rows after the statement boundary in the new period |
| Statement cut | `cut_card_statement` / `cut_due_card_statements` | `statement_debt_amount += statement-period current spending`; `current_period_spending` keeps only already-posted rows after the statement boundary; `debt_amount` unchanged | Inserts or returns an open `card_statement_archives` row; links posted expenses/installments whose dates are on or before the statement boundary under the guarded allocation context. Direct child re-allocation is rejected. Automatic due maintenance skips cards whose current spending belongs entirely to the next statement instead of surfacing an error. |
| Statement paid | `pay_card_statement` | Source bank account `current_balance -= archived statement amount`; card debt reduces by that amount and `statement_debt_amount` is reprojected from remaining open archives | Marks only the statement `paid`; installment rows remain unchanged. Temporary aggregate drift does not block payment. |
| Manual card debt paid | `pay_card_debt` | Source bank account `current_balance -= amount` (skipped with `p_skip_source_debit`); card `debt_amount -= amount`; statement debt is reduced first, then current-period spending | A full current-period payment inserts a payment settlement and allocates every unallocated current movement. Exact older excess left by a legacy aggregate payment first enters a source-less `historical_repair` settlement without another cash/card aggregate movement. Any remaining bucket-vs-row difference no longer rejects the payment: it is closed as an auditable residual recorded on the settlement note plus a `correction` history row (bank model — payment reduces the aggregate; row allocation is best-effort evidence). Direct marker writes remain rejected. |
| Planned payment paid from credit card | `pay_payment` with a credit-card source | Source credit card `debt_amount += paid amount`; `current_period_spending += paid amount` | Inserts a posted `card_expenses` row for the planned payment; advances or closes the payment row |
| Planned payment reconciled from card import | `pay_payment_from_card_import` | Source credit card `debt_amount += paid amount`; `current_period_spending += paid amount` | Inserts a posted `card_expenses` row using the bank movement/statement date; advances or closes the matched payment row |
| Statement import credit/refund row | `StatementImportModal` + `post_card_debt_correction` | Card `debt_amount -= amount`; negative correction reduces current-period spending first, then statement debt, then provision | DenizBank statement rows ending with `+ TL` are imported as auditable reverse entries instead of positive spending, so bank statement totals stay net of refunds/credits |
| Posted expense edited | `update_card_expense` | Reverses the previous unstatemented posted impact, then applies the new posted impact | Recreates installment rows for the edited expense. Rejects an expense already linked to a statement and an installment parent with any statement-linked child. |
| Old installment plan carried over | `record_card_installment_carryover` | `debt_amount += remaining installment total`; `current_period_spending += remaining installments whose exact due date has passed` | Called when the current installment number is greater than one; inserts one parent and only the current/future open rows. Earlier installments are not recreated as synthetic paid history. |
| Card debt recomputed from ledger | `recompute_card_debt_from_ledger` | `debt_amount = sum(card_ledger.amount_kurus) / 100`; if the projection lowers total debt, visible split is reduced from current period first, then statement, then provision | Suppresses the ledger trigger for this repair write so no duplicate event is emitted |
| Card debt manual correction | `post_card_debt_correction` | `debt_amount += signed correction`; positive corrections add to current-period spending, negative reverse entries reduce current period first, then statement, then provision | Writes an auditable `card_ledger.kind='adjustment'` event with the required reason note |
| Bank total snapshot reconciled | `reconcile_card_bank_snapshot` | `debt_amount = bank total remaining card burden`; statement/current/provision buckets stay unchanged | Bank total must include future installments and cannot be below the visible split. A paid archive's unallocated historical children are attached only when every eligible child plus the linked total exactly equals that archive amount; ambiguous matches are untouched. The total-only change is an auditable ledger adjustment. |
| Card import reset | `reset_card_import_data` | Sets visible card debt fields to `0` before a clean import rebuilds the non-paid/open scope | Deletes unarchived/non-paid-open expenses, installments, statement archives, and their history under a user/card-bound guard. It fails before mutation if current-settlement or paid-archive installment history makes a clean historical rebuild unsafe. The product import UI remains non-destructive. |
| Statement PDF authoritative rebuild | `replace_card_statement_import` | Reprojects the rebuildable open scope, replays every validated PDF row, locks the cut amount to the bank total, then cuts/reconciles the statement in one transaction | Preserves paid archives/current-settlement evidence and movements after the PDF statement date. It never matches/reuses a historical installment parent: each PDF installment line creates a fresh current/future open plan, while old paid archives remain untouched. |
| Legacy whole-card reset | removed (`reset_card_data`) | n/a | Removed because it predated immutable statement/current-settlement evidence and had no safe append-only reversal model. Full user reset remains the supported destructive reset. |

## Statement Boundary

Statements are cut the day after the statement day, not on the statement day.
This lets spending made on the statement day itself belong to that statement.

`cut_card_statement(p_card_id, p_statement_date default null, p_due_date
default null)`: when the optional dates are provided (only the statement PDF
import passes them), the bank document is the date authority — the PDF
statement date becomes the cut boundary and the archive's dates, provided it is
within ±7 days of the card-calendar boundary (bank weekend/holiday shifts fit
easily; a wrong-month PDF does not). Date-less calls (daily maintenance, client
cut) behave exactly as before. `replace_card_statement_import` also rejects a
PDF whose period already has a paid archive (or any paid archive with a newer
statement date): the rebuild scope only recognizes open archives, so replaying
a paid period would add the debt a second time and silently delete preserved
plans' open installments.

A carryover action without an explicit `existingExpenseId` reuses the ongoing
plan server-side: if exactly one preserved parent on the same card matches the
PDF's installment count and (normalized) description and carries paid/settled
history, its open children are rebuilt under that parent instead of creating a
new parent expense each month. Amount drift is deliberately not a matching
criterion (SI-07 accepts parent-total drift with a note); any ambiguity falls
back to a fresh parent.

The server-side daily maintenance job calls the same audited RPCs used by the
client:

- `cut_due_card_statements`
- `post_due_card_installments`
- `post_card_provision`

Do not duplicate their money-moving logic in a scheduler or page component.

## Payment Semantics

Bank screens may label only the immediately payable amount as current debt and
show future installments separately. Live reconciliation therefore asks for the
bank's total remaining card burden including all future installments. The
`reconcile_card_bank_snapshot` action changes only total debt and may repair an
exactly proven historical archive allocation before a full current-period
payment. It never debits a bank account; recording the payment remains a
separate action with an explicit source account.

`cardPayableDebt(card)` is:

```text
max(0, statement_debt_amount + current_period_spending)
```

Payable debt excludes provisions and future scheduled installment debt. A
provision must be posted before it becomes payable. Future installments first
become current-period debt when their own due date passes, then become payable
through the normal statement cut; they are not added again to dashboard debt.

Installment "paidness" in the UI is derived, not stored: statement payment
intentionally never touches installment rows, so `isInstallmentSettled`
(`src/utils/cardInstallmentCalendar.ts`) treats a row as paid when its status is
`paid`, it is linked to a current settlement, or its statement archive is
`paid`. `fetchCardInstallmentsByExpenseIds` embeds the archive status for this;
progress counters ("X/9 ödendi") must use this helper instead of raw status.

The canonical user flow is paying an open statement with `pay_card_statement`.
The archive's amount is bank truth; payment does not infer or mutate individual
installment lifecycle state. `pay_card_debt` is the optional manual/early payment path for posted
debt that is not represented by an open statement — including the full
current-period balance before the statement is cut (the Yapı Kredi pattern).
The cards page exposes it as a "Borç öde" button on each
credit-card row (shared payment drawer, editable amount defaulting to
`cardPayableDebt`, bank-account source). The button is disabled while the card
has an open statement archive, because `pay_card_debt` lowers
`statement_debt_amount` without closing the archive row (data health would flag
the mismatch) — the same reason the obligations calendar only emits its
`pay_card_debt` item for cards without an open statement.
`LiabilitiesCardsPage` (`/borclar/kartlar`) applies the same guard by switching
its button to the `pay_card_statement` flow whenever the card has an open
archive; `pay_card_debt` is offered only for archive-less cards.

The calendar's `pay_card_debt` item carries `maxPayableAmount`
(= `cardPayableDebt`) alongside its nominal `amount`
(= `statement_debt_amount`): the payment drawer validates and quick-fills
against the ceiling, while cash-flow projections keep using the nominal amount
so statement and current-period loads are not double-counted across months.

When `pay_card_debt` closes the full current-period balance, the database must
be able to allocate that amount exactly to posted, unstatemented single expenses
and posted installment rows. The allocation is recorded through
`card_current_settlements` and `current_settlement_id`; allocated single expenses
are excluded from later statement cuts and allocated installment rows become
`paid`. This prevents an early-paid movement from returning on the next
statement. Settled rows are historical evidence and cannot be edited or
deleted. A partial current-period payment remains aggregate-only and therefore
does not claim individual movement rows.

Legacy versions allowed aggregate-only payments that could leave already-paid
movements unallocated. On a later full current-period payment, the database
first tries the high-provenance repair: when `all unallocated posted - current
period` exactly equals all unallocated posted rows before the active
statement-cycle start, those rows receive a source-less `historical_repair`
settlement and no new cash or card-total movement. Any difference that remains
after that (legitimate row-less bucket moves: statement-import bank-total lock,
refund adjustments, auto-payment amount corrections, partial aggregate
payments) no longer hard-rejects the payment. All unallocated rows are attached
to the payment settlement and the bucket-vs-row difference is recorded as an
auditable residual (settlement note + `correction` history row); the bucket
reaches zero and consistency self-heals on every full payment.

Both `pay_card_debt` and `pay_card_statement` accept `p_skip_source_debit`
(default false): when the bank account balance was already reduced by the SMS
automation for the same payment, the RPC validates the source account but does
not debit it again; the history note records this. The payment drawer offers
this only when it finds an SMS-sourced outgoing movement on the selected
account with the same amount within the last 3 days.

The allocation marker is not a client-editable shortcut. Trigger authorization
requires the canonical RPC's transaction-local context plus matching user, card,
and parent rows. Current-settlement markers are removed from backup children
because their immutable parent is export-only. Historical statement markers are
restored by direct row replay and remain constrained by same-user/same-card RLS;
making that replay fully provenance-bound requires a future transactional restore
RPC.

Cash-flow/obligation projections must not reuse a paid statement's old due date
for new current-period spending. When no statement is pending, the current-period
cash due date comes from the card's active statement period; after the statement
day has passed, a paid statement due date (for example July 14) belongs to the
old statement, while new current-period spending moves to the next cycle (for
example August 14). When a statement is still pending, current-period spending
remains one cycle after that pending statement so both loads never collide.

When `pay_payment` is funded by a credit card instead of a bank account, it is
card spending, not cash outflow: the selected credit card receives a posted
expense and its `debt_amount` / `current_period_spending` increase by the paid
amount.

Card-instructed (`bank_auto` + card source) planned payments are informational
since BM-5: nothing posts them to the card proactively (the client hook and the
`post_due_card_auto_payments` maintenance RPC were removed). The real record
arrives from the SMS automation — which also advances the plan via the
`record_sms_card_expense` match — or from the monthly statement import
(`pay_payment_from_card_import`); manual "Öde" stays available. Estimated
amounts are therefore never written to a card.

DenizBank statement/current movement imports use `pay_payment_from_card_import`
for rows that match a still-open planned payment. It is the same credit-card
spending semantics as `pay_payment`, but the generated `card_expenses.spent_at`
uses the bank row date and the note keeps the planned-payment due date. This
prevents a bill from staying pending after its card movement is imported.

All card-expense-producing import paths carry a stable source event identity.
Statement/current-movement PDFs use the document-text SHA-256 plus a canonical row
content hash and that content's occurrence ordinal. The occurrence is intentionally
part of the identity: two identical rows in one document are two events, but
retrying/reimporting either row is a no-op; reordering different rows does not change IDs.

## Ledger Authority

`card_ledger` is the append-only audit trail for `cards.debt_amount`. Ordinary
RPCs continue to update `cards.debt_amount`; the trigger records each delta as
integer kuruş. Repair flows follow the same append-only rule:

- `recompute_card_debt_from_ledger` pulls `debt_amount` back to the exact ledger
  projection and suppresses the trigger for that repair write.
- `post_card_debt_correction` is the preferred manual fix. It changes
  `debt_amount` through a signed adjustment and records the reason in
  `card_ledger`.
- `reconcile_card_bank_snapshot` is the bank-truth total-only fix. It preserves
  visible buckets, records the total delta as an adjustment, and repairs only
  exact paid-archive allocation gaps.
- Data Health's `apply_data_health_safe_repairs` may invoke the recompute or
  clamp invariant only after locking every submitted card and validating the
  exact scan-time `updated_at`; the whole card/account plan rolls back on one
  stale target and records a conflict receipt. Applied/skipped targets receive
  immutable before/after step receipts.

Authenticated REST clients have no `card_ledger` INSERT grant or policy. Ledger
events are produced only by hardened trigger/correction paths; an owner-readable
append-only table is not client-writable aggregate authority.

Do not patch `debt_amount` directly from page code or data-health logic. Use the
ledger correction RPCs or fix the upstream transition that created the drift.
Scheduled-debt gaps, partial scheduled overlaps, and installment overflow do not
identify which side is stale without bank truth; Data Health reports them as
non-fixable review issues and must not derive/write a replacement debt total.
Structural installment findings never use generic Data Health REST writes.
Current, unallocated plans navigate to the canonical parent-plan editor that
owns sibling locks/rebuilds; archived, settled, or ambiguous history remains
manual reconciliation because rebuilding it would rewrite historical membership.

### Bucket Tracking

Each `card_ledger` event now carries three nullable bucket deltas:
`statement_delta_kurus`, `current_delta_kurus`, `provision_delta_kurus`. These
are computed automatically by the AFTER trigger from `OLD` vs `NEW` breakdown
fields — no RPC changes needed.

- `'reclass'` kind captures zero-debt-delta bucket shifts (e.g. statement cut
  moves current → statement without changing total debt).
- `projectCardSplit(events)` in `src/utils/cardLedger.ts` is the TS projection.
  `complete: true` means all events had bucket deltas (full-fidelity).
- `recompute_card_debt_from_ledger` uses bucket projections when all events have
  deltas, falling back to the current → statement → provision heuristic otherwise.
- Pre-migration events have null deltas and cannot be backfilled.

The `LiveReconciliationPanel` on `/veri-sagligi` now offers a "Farkı düzelt"
button for credit cards: user enters the bank's real debt (total remaining
burden including future installments) and the panel applies it through
`reconcile_card_bank_snapshot` — no PDF import needed. (`post_card_debt_correction`
remains the generic signed-correction RPC used by the statement-import lock.)

## Data-Health Expectations

Data health may flag:

- split total greater than `debt_amount`
- scheduled installments wholly missing from debt composition
- partial overlap where visible split + scheduled installments exceed total debt
  even though the visible split alone does not
- unexplained card debt where `debt_amount` is greater than visible split plus
  scheduled installments
- cards over shared/individual limit
- statement/archive mismatches
- overdue open statement archives that likely need a `pay_card_statement` flow
- Card-list due-date and overdue badges use the earliest unpaid open archive's
  `due_date`. `nextMonthlyDate(due_day)` is only a fallback when no payable open
  archive exists; it cannot be used to detect an already overdue statement.
- ledger drift between `card_ledger` projection and `cards.debt_amount`

When fixing one of these, keep the field transition above intact and prefer a
single RPC/helper change over page-local compensation.
