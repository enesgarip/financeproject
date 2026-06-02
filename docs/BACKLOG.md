# Priority Backlog

## P0 - High Confidence / High Value

- Break large finance-heavy page files into smaller domain modules without changing behavior.
  - Highest candidates: `DashboardPage.tsx`, `CardsPage.tsx`, `DataHealthPage.tsx`
- Add explicit regression coverage for finance math.
  - statement period calculation
  - shared credit limit grouping
  - payable card debt excluding provision
  - recurring payment month occurrence
  - budget alert thresholds
- Create a single documented source of truth for card debt transitions.
  - expense added
  - provision posted
  - statement cut
  - debt paid
- Continue banking simplification from `docs/BANKING_SIMPLIFICATION_AUDIT.md`.
  - shared account-payment drawer
  - shared account movement helper/RPC family
  - normalized upcoming obligations view

## P1 - Product / Reliability

- Reduce fallback logic that depends on missing Supabase schema cache or missing RPC deployment.
- Improve visibility of migration/version mismatches between frontend expectations and live database state.
- Document and standardize transaction history side effects for all finance mutations.
- Review whether recurring payments, loan installments, and card installments can be unified under a clearer planning model.

## P2 - UX / Maintainability

- Add a concise developer-oriented architecture note for each major page.
- Reduce repeated money helper logic such as `roundMoney`, split-total helpers, and schema-cache checks.
- Clarify where dashboard calculations belong versus page-local calculations.
- Audit Turkish copy and encoding consistency across UI strings and docs.

## P3 - Nice to Have

- Add import/export or backup flow for personal finance data.
- Add stronger historical analytics for cash flow and debt trend.
- Add better scenario planning around next-month and multi-month obligations.

## Suggested Next Tasks for Codex

1. Add targeted tests for `cardStatement`, `budgetAlerts`, and savings goal progress.
2. Extract reusable card math helpers from page files into a single domain utility.
3. Map all Supabase RPCs to user-visible actions in a short reference doc.
4. Create a small migration compatibility checklist for releases.
