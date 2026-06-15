# Dashboard Architecture Note

Last reviewed: 2026-06-15

This note is a quick map for changes touching `/` (`DashboardPage`). Start with
`CLAUDE.md` and `docs/AI_CONTEXT_INDEX.md`; use this file after you know the
task is dashboard-specific.

## Responsibility

`src/pages/DashboardPage.tsx` is route orchestration. It should:

- load the shared finance snapshot through `useFinanceSnapshot`
- build memoized view-model inputs for panels and insight utilities
- compose dashboard panels from `src/components/dashboard/*`
- keep UI state local only when it is truly route-level

It should not own new finance formulas, Supabase calls, or payment/RPC side
effects. Put those in the existing utility, repository, or service layer.

## Data Flow

The dashboard reads one snapshot:

1. `src/app/useFinanceSnapshot.ts`
2. `src/data/repositories/financeSnapshotRepo.ts`
3. `src/pages/DashboardPage.tsx`
4. Pure utilities and dashboard panels

`DashboardPage` and `AnalysisPage` intentionally share the same snapshot source.
If a derived value should agree between both screens, prefer a pure utility in
`src/utils/*` over page-local filtering.

## Derived Math Ownership

Use these owners before adding dashboard math:

- net worth, cash flow, card debt, credit limits, salary, goals:
  `src/utils/financeSummary.ts`
- upcoming obligations, monthly load, dated payment/card/loan/debt rows:
  `src/utils/obligations.ts` through `src/utils/dashboardUpcoming.ts`
- attention line:
  `src/utils/attention.ts`
- insight and focus cards:
  `src/utils/dashboardInsights.ts`
- forward cash projection:
  `src/utils/cashFlowForecast.ts`

Money aggregation must use `src/utils/money.ts` helpers, or existing
`financeSummary.sum()` where the local pattern already uses it.

## Page-Local vs Shared Calculations

Keep `DashboardPage` calculations limited to orchestration glue:

- narrowing the shared snapshot to dashboard windows, such as recent history or
  current-month budgets
- combining already-derived utility results into a dashboard view model
- tiny presentation flags or counts, such as whether a panel should render
- memo dependency wiring for route-level state

Move a calculation out of `DashboardPage` when it answers a finance question,
depends on money arithmetic, repeats in another route, affects Data Health, or
needs a test name of its own. Use this default target:

| Calculation Kind | Owner |
| --- | --- |
| Product-wide financial totals, card debt splits, credit limits, salary, goals | `src/utils/financeSummary.ts` |
| Dated obligations, cash impact, next-month load | `src/utils/obligations.ts` and `src/utils/dashboardUpcoming.ts` |
| Dashboard-only insight/action ranking | `src/utils/dashboardInsights.ts` |
| Cross-screen forecast or scenario math | `src/utils/cashFlowForecast.ts` or another focused `src/utils/*` module |
| Formatting, icons, badges, visual tone | `src/components/dashboard/*` |

If a value must match Analysis, Cards, Data Health, or an RPC/trigger invariant,
the page is only a consumer. Put the rule in the shared utility and add focused
Vitest coverage there.

## Obligation Input

Dashboard upcoming items and next-month load use the same normalized obligation
input:

- `cards`
- `payments`
- `loans`
- `loanInstallments`
- `debts`
- `cardInstallments`
- `cardStatements`

Do not reimplement card statement, recurring payment, loan installment, or
personal debt date filtering inside `DashboardPage`. Add behavior to
`src/utils/obligations.ts` first, then adapt dashboard-specific presentation in
`src/utils/dashboardUpcoming.ts`.

## Panels

`src/components/dashboard/DashboardPanels.tsx` owns presentational dashboard
panels only. It may format values and choose badges/tone, but new business rules
belong in `src/utils/*`.

If a panel grows a complex local calculation, extract it to a utility and cover
it with focused Vitest tests.

## Verification

For dashboard changes, usually run:

```bash
npm exec -- vitest run src/utils/dashboardUpcoming.test.ts src/utils/dashboardInsights.test.ts src/utils/financeSummary.test.ts
npm run lint
npm run test:unit
npm run build
```

Add browser or Playwright coverage when the change affects visible layout,
navigation, or user flow.
