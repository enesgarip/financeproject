# FinanceProject Project Context

## Purpose

FinanceProject is a Turkish personal finance PWA for tracking:

- cash and investment assets
- bank cards and credit cards
- loan balances and installments
- personal debts/receivables
- recurring and one-off payments
- card expenses, provisions, statements, and installment plans
- savings goals and salary history
- dashboard-level cash flow and data health signals

The main product goal is to make monthly financial load visible before due dates are missed.

## Current Tech Stack

- Frontend: React 19 + TypeScript + Vite
- Routing: `react-router-dom`
- Styling: Tailwind CSS v4
- UI primitives: local `src/components/ui/*` wrappers plus Radix-based patterns
- Icons: `lucide-react`
- Backend/BaaS: Supabase
- Auth: Supabase Auth (email/password)
- Database: Postgres via Supabase, with RLS
- Deployment target: Vercel
- PWA assets: `public/manifest.webmanifest`, `public/sw.js`

## App Structure

## Frontend

- App shell and routes: `src/App.tsx`
- Auth state: `src/auth/*`
- Shared generic CRUD page: `src/components/CrudPage.tsx`
- Layout/navigation: `src/components/Layout.tsx`, `src/components/BottomNav.tsx`, `src/components/navigation.ts`
- Pages:
  - `DashboardPage.tsx`
  - `AssetsPage.tsx`
  - `CardsPage.tsx`
  - `LoansPage.tsx`
  - `DebtsPage.tsx`
  - `PaymentsPage.tsx`
  - `AnalysisPage.tsx`
  - `DataHealthPage.tsx`
  - `MorePage.tsx`
  - `LoginPage.tsx`

## Backend / Data

- Supabase client: `src/lib/supabase.ts`
- Typed schema and RPC contracts: `src/types/database.ts`
- SQL migrations: `supabase/migrations/*`

Backend behavior is split between:

- direct table CRUD from the frontend
- Supabase RPC calls for finance-specific mutations

## Important Domain Areas

## Cards

Cards are the densest domain area in the repo. The current model includes:

- bank cards (`banka_karti`) with `current_balance`
- credit cards (`kredi_karti`) with:
  - `credit_limit`
  - `debt_amount`
  - `statement_debt_amount`
  - `current_period_spending`
  - `provision_amount`
  - `statement_day`
  - `due_day`
  - optional `limit_group_name` for shared-limit cards

Supporting tables/features:

- `card_expenses`
- `card_installments`
- `card_statement_archives`
- card-related RPCs such as `add_card_expense`, `post_card_provision`, `cut_card_statement`, `cut_due_card_statements`, `pay_card_statement`, `pay_card_debt`

Credit-card installments are planning rows inside the card statement flow. They are not separate debt, and a linked statement payment is responsible for closing the included installment rows.

## Planning / Monitoring

The app has several planning-oriented layers already in place:

- dashboard monthly cash flow projection
- upcoming payment reminders
- credit limit usage grouping
- budget alerts based on card expenses
- installment calendar summaries
- data integrity checks and safe-fix workflows in `DataHealthPage`

## Key Utilities

- currency and number formatting: `src/utils/formatCurrency.ts`
- date helpers: `src/utils/date.ts`
- statement period logic: `src/utils/cardStatement.ts`
- installment calendar aggregation: `src/utils/cardInstallmentCalendar.ts`
- budget alert calculation: `src/utils/budgetAlerts.ts`
- savings goal progress rules: `src/utils/savingsGoal.ts`
- transaction history helpers: `src/utils/history.ts`

## Route Model

- `/` dashboard
- `/varliklar`
- `/kartlar`
- `/krediler`
- `/borclar`
- `/odemeler`
- `/analiz`
- `/veri-sagligi`
- `/daha`
- `/login`

All app routes except `/login` are protected by `ProtectedRoute`.

## Database Notes

From the current typed schema, main tables are:

- `assets`
- `cards`
- `card_expenses`
- `budgets`
- `savings_goals`
- `savings_goal_components`
- `card_installments`
- `card_statement_archives`
- `loans`
- `loan_installments`
- `debts`
- `payments`
- `transaction_history`
- `salary_history`
- `dismissed_upcoming_items`

Most rows are user-scoped with `user_id`. RLS is a core security assumption.

## Current Product Shape

This is not just a simple CRUD app anymore. It has evolved into:

- a personal ledger
- a monthly planning tool
- a credit card statement/installment tracker
- a data quality repair surface

Any new work should preserve that direction instead of reducing the app back to plain list management.
