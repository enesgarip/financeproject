# Denge

**English** · [Türkçe](README.tr.md)

**A personal finance app that makes your monthly financial load visible before a due date slips past.**

Denge (Turkish for "balance") is a Turkish-language personal finance PWA that
brings cash, credit cards, loans, personal debts and planned payments together
in one place. The goal is not to keep a simple "income–expense list" but to
**show in advance what will leave your pocket this month and in the months
ahead** — before the statement closes, before the next installment, before the
payment day passes.

`React · TypeScript · Supabase · PWA` — single-user, Turkish lira, Turkish UI.

![Denge — Finance Overview](docs/screenshots/dashboard.png)

## What does it do?

The real challenge in personal finance is not individual purchases but
**seeing overlapping obligations in time**: the credit-card statement, card
installments, loan installments, debts to people and recurring payments all
land in the same month. Denge folds all of them into a single model and
answers one question:

> _"Am I balanced this month and the following ones — where, when and how much do I need to pay?"_

## Who is it for?

Denge is for people juggling **multiple bank accounts, credit cards and
installment plans** who want to see their cash balance ahead of time when
statement cuts, installment schedules and recurring payments stack up within a
month. In short, it targets single-person use looking for a clear answer to
_"what will leave my pocket this month and in the months ahead?"_ (Turkish
lira, Turkish UI).

**Who it is not for:** it is not designed for multi-user company bookkeeping,
team/role management, or multi-currency investment portfolio tracking.

## Features

- **Accounts & assets** — Bank accounts, cash and investment assets, salary
  history and gold tracking. Balances are event-sourced.
- **Credit card management** — Purchases, provisions (pending authorizations),
  statement cuts, installment purchases and mid-period payments. Debt is broken
  down into current-period / statement / provision buckets.
- **Loans & personal debts** — Loan installment plans plus debt/receivable
  tracking with people, complete with an installment calendar.
- **Planning & payment calendar** — Upcoming payments, monthly cash-flow
  projection, budget alerts, savings goals and installment schedule summaries.
- **Analysis & net worth** — Net worth, wealth and cash-flow trends;
  transaction history.
- **AI Assistant** — Chat about your own financial data in Turkish
  (`/analiz/asistan`). Questions are sent to Google Gemini together with a
  compact summary generated from your current in-app data; history persists
  across devices.
- **Decision tools** — "Should I buy it?" (a purchase's impact on future
  months), shopping list (30-day cooling-off rule + "when can I buy it"),
  spending contexts (pet / event / project budgets).
- **Vehicles & TCO** — Per-vehicle expenses, fuel logging, reminders and a
  total-cost-of-ownership report card.
- **Data health & backup** — An audit surface that detects inconsistencies and
  offers safe correction flows (deterministic, ownership- and type-checked
  repairs); single-file JSON backup/restore, notification preferences.
- **PWA** — Installable to the home screen, offline shell, quick shortcuts
  (add expense, planned payments, analysis), light/dark themes, Web Push
  notifications.

## Status

- **Stable (core):** accounts & assets, credit-card debt / statements /
  installments, loans, personal debts & receivables, payment calendar,
  analysis & net worth, data health, Web Push notifications (preferences +
  quiet hours).
- **In progress:** reading provisions/transactions from SMS and bank statement
  import (DenizBank, YapıKredi) run in the browser; whole-statement line-total
  validation uses two independent checksums calibrated on real statements
  (see `docs/BACKLOG.md`). The AI assistant is a recent addition (Gemini free
  tier).

## Visual language: Şerit (Nocturne)

The UI uses the **Şerit** ("stripe") visual language introduced with the
2026-08 redesign: rows separated by hairlines instead of stacked shadowed
boxes, a single hero number per screen, mono + tabular numerals for financial
figures; a card only where a block earns one. The color identity is
**Nocturne**: a warm porcelain light theme, a dark obsidian dark theme and a
jade accent — both themes are first-class. Rules:
[`docs/UI_ARCHITECTURE.md`](docs/UI_ARCHITECTURE.md) (Turkish).

## Screenshots

> The screenshots below were taken in a local development environment with
> **representative demo data**.

| Accounts & cards | Loans & installments |
| --- | --- |
| ![Accounts](docs/screenshots/accounts.png) | ![Loans](docs/screenshots/loans.png) |
| **Payment calendar** | **Analysis & month close** |
| ![Payment calendar](docs/screenshots/payments.png) | ![Analysis](docs/screenshots/analysis.png) |
| **AI Assistant** | **Should I buy it?** |
| ![AI Assistant](docs/screenshots/assistant.png) | ![Should I buy it](docs/screenshots/decision.png) |

## Privacy & security

> - Your data stays in **your own Supabase project**; it never goes to a
>   third-party server.
> - Row Level Security (RLS) on every table: every row is scoped by
>   `user_id = auth.uid()`.
> - Only the **anon key** ever reaches the client; the **service role** key is
>   never shipped to it.
> - Frontend filtering is never trusted — authorization is enforced in the
>   database.

## Money model (the foundation of trust)

The most critical thing in a finance app is monetary precision. Denge stores
money as `numeric` in the database and as **signed integer kuruş** (the Turkish
cent) in the ledger tables; every rounding/comparison on the JS side goes
through a single core (`src/utils/money.ts`). The big monetary figures — card
debt, bank balance, loan summary, card-debt breakdown — are either derived
from events or protected by database triggers at write time, so inconsistency
becomes mathematically impossible. Corrections never rewrite history; they are
appended as **reversal entries** (append-only).

## Architecture

Layer boundaries are enforced with ESLint; the UI can never see Supabase
directly:

```
domain   → src/utils/*              Pure calculation/business rules. Heavily tested.
data     → src/data/repositories/*  The only Supabase contact. Returns Result<T>.
app      → src/app/*                TanStack Query use-case hooks.
ui       → src/pages, components    "Dumb" presentation layer.
services → src/services/*           RPC wrappers.
lib      → src/lib/*                supabase client, error logging, external clients.
```

**Tech:** React 19 · TypeScript · Vite 7 · Tailwind CSS v4 · TanStack Query ·
React Router v8 · Supabase (Postgres + Auth + Edge Functions) · Google Gemini
(receipt/statement parsing + AI assistant, edge-only) · Vercel (+ Analytics) ·
PWA.

There is no remote error-tracking service (Sentry was removed on 2026-08-19):
crashes and errors are tracked in-app via `AppErrorBoundary` plus a dedicated
`client_errors` table under RLS.

## Getting started

```bash
npm install

npm run dev            # Connects to production Supabase (.env.local required)
npm run dev:local      # Local Supabase (docker) + Vite — never touches production
npm run dev:local:stop # Stops the local Supabase docker
npm run db:seed:local  # Resets the local DB + loads demo data
```

1. Create a Supabase project (or use `npm run dev:local` for local
   development).
2. Apply the migrations under `supabase/migrations/*` with the CLI.
3. Copy `.env.example` to `.env.local` and fill in the values:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

Local demo login: `t@t.com / password123` (run `npm run db:seed:local` first;
valid only on the local docker).

Before calling a change "done" (the exact local mirror of the CI quality gate —
lint + tests with coverage + dependency audit + build + bundle budget + edge
type check):

```bash
npm run verify
```

For an end-to-end smoke test, `npm run test:e2e` (Playwright) can be run
separately.

## Deploy

A push to `main` = production deploy (GitHub Actions → Vercel). The frontend is
built as a single artifact and uploaded staged; if the DB changed, an encrypted
backup is taken before migrations are applied; if the post-release `/login`
smoke test fails, an automatic rollback kicks in. Details:
[`docs/PIPELINE.md`](docs/PIPELINE.md) (Turkish).

## Contributing & AI agents

This repository is documented for working with AI agents (Claude Code, Codex).
When starting a session, read
[`docs/AI_CONTEXT_INDEX.md`](docs/AI_CONTEXT_INDEX.md) first — it gives the
cheapest task-based reading route and the topic→file table. The canonical
rules live in [`CLAUDE.md`](CLAUDE.md), and the domain + table + route map in
[`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md). Project documentation is
in Turkish.

## License

[MIT](LICENSE) © Enes Garip
