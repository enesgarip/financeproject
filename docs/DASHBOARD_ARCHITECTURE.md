# Dashboard Architecture Note

Last reviewed: 2026-08-12

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
- focus actions (`buildFocusActions`) and reconciliation drift count:
  `src/utils/dashboardInsights.ts`
- hero number ("harcanabilir"): `src/utils/safeToSpend.ts` through
  `src/hooks/useSafeToSpend.ts` (see UX contract below)
- month strip derivation: `src/utils/dashboardMonthStrip.ts`
- forward cash projection: `src/utils/cashFlowForecast.ts` (shared owner; its
  current consumers are the purchase-decision and analysis screens, not a
  dashboard panel)

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

`src/components/dashboard/*` owns presentational dashboard panels only. These
modules may format values and choose badges/tone, but new business rules belong
in `src/utils/*`.

Current module split (post-Şerit):

- `SeritOverview.tsx`: the Şerit body of the dashboard — hero number, liquid
  account rows, upcoming dues, buffer row wiring. Pure presentation; every
  number arrives precomputed from `DashboardPage`.
- `SeritMonthStrip.tsx`: the month strip chart (one of the few allowed raised
  blocks).
- `SeritBufferRow.tsx`: safety-buffer editing row (formerly the bottom of the
  removed `SafeToSpendCard`).
- `DashboardCards.tsx`: `HistorySection` (transaction history presentation).
- `DashboardInsights.tsx`: `FocusActionPanel` (focus actions list).
- `DashboardPanels.tsx`: mostly legacy — only the `FocusAction` type is still
  imported; the `DashboardHero`/`MetricTile`/`PulseCard` components have no
  live consumers.
- `dashboardPanelUtils.ts`: dead module (no imports anywhere); candidate for
  deletion.
- `StatementReminderPanel.tsx` and `ReconciliationPanel.tsx`: focused
  companion panels.

If a panel grows a complex local calculation, extract it to a utility and cover
it with focused Vitest tests.

## UX And Accessibility Contract

Dashboard panels are dense operational UI, so keep the interaction contract
predictable:

- The hero number is the Şerit "harcanabilir" figure rendered by
  `SeritOverview`; there is no signature card anymore (the old
  `SafeToSpendCard`/`DashboardHero` dark surfaces were removed with the Şerit
  redesign). Do not add duplicate summary panels above or beside it.
- The hero calculation lives in `src/utils/safeToSpend.ts` and is wired
  through `src/hooks/useSafeToSpend.ts`. Callers of `buildSafeToSpend` MUST
  pass the `reserved` (kasa reserve) input — Faz D4 guard: without it the
  same-named number differs between screens. `useKasaReserved` in the hook
  supplies it, and `src/utils/safeToSpend.guard.test.ts` enforces this in CI.
- Negative monetary values in the hero/decision rows must stay on one line at
  narrow widths (`.serit-num` tabular figures help; do not wrap the amount).
- The loading dashboard skeleton must expose a polite loading state
  (`role="status"` / `aria-busy`) while individual skeleton blocks stay
  decorative.
- Route-level load errors must be actionable. Show a clear failure title, the
  underlying message, and a retry action wired to the snapshot query.
- Optional alert panels should not leave empty grid rows or columns when there
  is no alert content. Either render the wrapper conditionally or show a useful
  positive empty state.
- Custom links/buttons used as actions, filters, or show-more toggles should
  keep a visible focus ring and a minimum 44px touch target.
- Progress bars and charts need accessible labels or summaries. Visual tooltip
  content must not be the only way to understand a chart.
- Respect `prefers-reduced-motion` for route/detail animations and CSS shimmer
  effects.

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
