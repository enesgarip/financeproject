# FinanceProject Codex Guide

## Goal of This File

This guide tells future Codex sessions how to work in this repo with low re-explanation cost and low regression risk.

For the cheapest routing map, read `docs/AI_CONTEXT_INDEX.md` first. This file
explains working rules; the index tells you which deeper doc or code area to
open for a specific task.

## Working Style for This Repo

1. Read a small amount first.
2. Prefer existing patterns over new abstractions.
3. Keep edits narrow unless the task explicitly asks for broader cleanup.
4. Preserve Turkish product language in UI text.
5. Be careful with finance logic, not just UI appearance.

## First Files to Read

When starting a new task, usually inspect these first:

- `docs/AI_CONTEXT_INDEX.md`
- `src/App.tsx`
- `src/types/database.ts`
- `src/components/CrudPage.tsx`
- the target page under `src/pages/*`
- the matching utility under `src/utils/*`
- relevant latest migrations in `supabase/migrations/*`

## Repo Conventions

## Architecture

- Frontend-driven app with Supabase as backend
- Generic CRUD surface reused by domain pages
- Domain-heavy logic often lives in page files and `src/utils/*`
- Some critical mutations are in Supabase RPC functions, not only local UI code

## Coding Standards

- TypeScript first
- Functional React components
- Reuse existing helpers before adding new utility files
- Prefer typed table access using `TableName`, `RowFor`, `InsertFor`, `UpdateFor`
- Keep money math rounded to 2 decimals when business logic requires it
- Respect current styling system instead of mixing in new UI libraries

## When Giving Codex a Task

Good task framing should include:

- target page or feature
- whether this is UI-only, data-only, or both
- whether Supabase migration changes are allowed
- what financial behavior must remain unchanged
- what edge cases matter

Example:

`CardsPage'de provizyon toplamını grup bazında göster, ama mevcut borç ödeme akışını değiştirme. Migration yapma.`

## Rules Codex Should Follow

- Do not change finance calculations casually.
- Before editing, identify whether the source of truth is:
  - frontend helper
  - page-level calculation
  - Supabase RPC
  - migration/schema
- For card, loan, debt, and payment flows, verify side effects on dashboard and data health views.
- If a change affects table shape or RPC contracts, check `src/types/database.ts` and migrations together.
- If a change affects release compatibility, use `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md`.
- If a change affects an RPC-backed user action, update `docs/RPC_ACTION_REFERENCE.md`.
- If a bug touches card debt math, also review:
  - `docs/CARD_DEBT_TRANSITIONS.md`
  - `statement_debt_amount`
  - `current_period_spending`
  - `provision_amount`
  - `debt_amount`
  - `card_installments`

## Constraints for Codex Sessions

- Avoid broad refactors unless explicitly requested.
- Treat encoding/mojibake as an active risk area.
- Be extra careful in files that mix UI and business rules, especially:
  - `DashboardPage.tsx`
  - `CardsPage.tsx`
  - `DataHealthPage.tsx`
- If a feature already has a repair path in data health, document that impact in the final summary.

## Recommended Task Checklist

Before finishing a task:

1. Check whether routes, utilities, types, and migrations still align.
2. Consider dashboard impact for finance changes.
3. Consider data health impact for derived totals.
4. Run the smallest useful verification available.
5. Summarize assumptions clearly.

## Session Memory Shortcuts

- Shared-limit credit cards exist.
- Credit card debt is split into statement debt, current-period spending, and provision.
- Loan tracking may use either explicit installments or legacy monthly summary fields.
- Payments can be recurring monthly.
- Savings goals can be TRY, gold-based, or composite.
- Data health page is a real operational tool, not just a debug page.
