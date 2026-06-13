# FinanceProject Project Context

For AI/Codex sessions, start with `docs/AI_CONTEXT_INDEX.md` to choose the
smallest relevant context path before reading this full project map.

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

> Kanonik kurallar `CLAUDE.md`'de, dosya haritası `docs/AI_CONTEXT_INDEX.md`'de.
> Bu dosya domain + tablo + route haritasını tutar.

## Current Tech Stack

- Frontend: React 19 + TypeScript + Vite 7
- Data fetching/cache: **TanStack Query** (use-case hook'ları `src/app/*`)
- Routing: `react-router-dom`
- Styling: Tailwind CSS v4
- UI primitives: local `src/components/ui/*` wrappers plus Radix-based patterns
- Icons: `lucide-react`
- Backend/BaaS: Supabase (Postgres + Auth + Edge Functions)
- Auth: Supabase Auth (email/password)
- Database: Postgres via Supabase, with RLS (her public tablo RLS açık, CI denetler)
- Error tracking: **Sentry** (yalnız frontend; edge'de yok)
- Deployment target: Vercel (`main`'e push = üretim deploy)
- PWA assets: `public/manifest.webmanifest`, `public/sw.js`

## App Structure

## Frontend

- App shell and routes: `src/App.tsx`
- Auth state: `src/auth/*`
- Shared generic CRUD page: `src/components/CrudPage.tsx`
- Layout/navigation: `src/components/Layout.tsx`, `src/components/BottomNav.tsx`, `src/components/navigation.ts`
- Pages:
  - `DashboardPage.tsx`
  - `AssetsPage.tsx` (Varlıklar hub: `AssetsHub.tsx` → varlıklar + `SalaryPage.tsx` + `GoldPage.tsx`)
  - `CardsPage.tsx`
  - `LoansPage.tsx` / `DebtsPage.tsx` (Borçlar hub: `LiabilitiesHub.tsx`)
  - `PaymentsPage.tsx`
  - `AnalysisPage.tsx`
  - `DataHealthPage.tsx`
  - `LoginPage.tsx`

## Backend / Data (katmanlı — ESLint ile zorlanır)

```
domain   → src/utils/*               Saf hesap/iş kuralı. Supabase görmez. Yoğun test.
data     → src/data/repositories/*   TEK Supabase teması. Result<T> döndürür.
app      → src/app/*                 TanStack Query use-case hook'ları (useFinanceSnapshot).
ui       → src/pages, src/components  "Aptal" sunum. Supabase görmez.
services → src/services/*            RPC sarmalayıcıları (kasıtlı; doğrudan supabase).
lib      → src/lib/*                 supabase client, sentry, harici istemciler.
```

- Supabase client: `src/lib/supabase.ts` (UI'dan import etmek ESLint HATA'sı)
- Typed schema and RPC contracts: `src/types/database.ts`
- SQL migrations: `supabase/migrations/*`
- Repositories: `src/data/repositories/*` (her domain için bir repo, `Result<T>`)

Backend behavior is split between direct table CRUD (repo katmanından) ve
finance-specific mutation'lar için Supabase RPC çağrıları (`src/services/*`).

## Para modeli (EN ÖNEMLİ KURAL)

- Para hesabı/karşılaştırması **yalnız `src/utils/money.ts`** üzerinden
  (`roundTL`, `equalsTL`, `greaterThanTL`, `toKurus`/`toTL`, `sumTL`). Çıplak
  `Math.round(x*100)/100` veya `+0.01` toleransı yazma.
- Ledger tabloları parayı **işaretli integer kuruş** (`amount_kurus bigint`) tutar.
- **Ledger invariant'ları:** kart borcu → `card_ledger`, banka bakiyesi →
  `account_ledger`, kredi özeti → `loan_installments` (AFTER trigger). Her SQL
  trigger'ın saf TS ikizi var (`financeSummary.ts`). Düzeltme = ters kayıt
  (append-only), asla geçmişi UPDATE etme. Detay: `CLAUDE.md`.

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

Para çekirdeği `src/utils/money.ts` (zorunlu — bkz. "Para modeli"). Konuya göre
util ↔ repo ↔ sayfa eşlemesinin **tam ve güncel listesi** `docs/AI_CONTEXT_INDEX.md`
tablosundadır; burada tekrarlamak drift yaratır.

## Route Model

- `/` dashboard
- `/kartlar` (Hesaplar)
- `/varliklar` hub → index (Varlıklar) + `/varliklar/maas` (Maaş)
- `/borclar` hub → `/borclar/krediler` (Krediler) + `/borclar/kisiler` (Kişiler); bare `/borclar` redirects to krediler
- `/odemeler`
- `/analiz` (Raporlar)
- `/veri-sagligi`
- `/login`
- Legacy redirects: `/krediler` → `/borclar/krediler`, `/daha` → `/`

All app routes except `/login` are protected by `ProtectedRoute`.

Navigation (`src/components/navigation.ts`): bottom bar (mobile, 5) = Özet · Hesaplar · Varlıklar · Borçlar · Planlı; desktop sidebar adds Raporlar; Raporlar + Veri Kontrolü + Çıkış live in the mobile header menu.

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
