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
- Routing: `react-router` v8 (declarative mode; `react-router-dom` re-export package is not used)
- Styling: Tailwind CSS v4
- UI primitives: local `src/components/ui/*` wrappers plus Radix-based patterns
- Icons: `lucide-react`
- Backend/BaaS: Supabase (Postgres + Auth + Edge Functions)
- Auth: Supabase Auth (email/password)
- Database: Postgres via Supabase, with RLS (her public tablo RLS açık, CI denetler)
- Error tracking: **Sentry** (yalnız frontend; edge'de yok)
- Deployment target: Vercel (protected `main` merge = production deploy)
- PWA assets: `public/manifest.webmanifest`, `public/sw.js`

## App Structure

## Frontend

- App shell and routes: `src/App.tsx`
- Auth state: `src/auth/*`
- Shared generic CRUD page: `src/components/CrudPage.tsx`
- Layout/navigation: `src/components/Layout.tsx`, `src/components/BottomNav.tsx`, `src/components/navigation.ts`
- Pages:
  - `DashboardPage.tsx`
  - `AssetsPage.tsx` (Varlıklar hub: `AssetsHub.tsx` → varlıklar + `SalaryPage.tsx` + `GoldPage.tsx` + `CarsPage.tsx`)
  - `CardsPage.tsx`
  - `LoansPage.tsx` / `DebtsPage.tsx` / `LiabilitiesCardsPage.tsx` (Borçlar hub: `LiabilitiesHub.tsx`)
  - `PaymentsPage.tsx` / `PlanningPage.tsx` / `PurchaseDecisionPage.tsx` / `WishlistPage.tsx` / `ExpenseContextsPage.tsx` (Planlama hub: `PlanningHub.tsx`)
  - `AnalysisPage.tsx` / `AnalysisDetailPage.tsx` (+ `AnalysisPage.*` parçaları; Analiz hub: `AnalysisHub.tsx`)
  - `DataHealthPage.tsx` / `DataHealthOperationsPage.tsx` (Veri Kontrolü hub: `DataHealthHub.tsx`)
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
- `card_current_settlements` (full current-period payments made before statement cut)
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

Deterministic Data Health recomputations use
`apply_data_health_safe_repairs`: each 1..100-entry, duplicate-free plan is
single-domain, owner/type checked, target-locked, exact-`updated_at` guarded, and
bound to its idempotency key. The bulk UI includes only card/account repairs;
loan summary drift is submitted as an individual loan-domain action.

## Key Utilities

Para çekirdeği `src/utils/money.ts` (zorunlu — bkz. "Para modeli"). Konuya göre
util ↔ repo ↔ sayfa eşlemesinin **tam ve güncel listesi** `docs/AI_CONTEXT_INDEX.md`
tablosundadır; burada tekrarlamak drift yaratır.

## Route Model

Live routes (source of truth: `src/App.tsx`):

- `/` dashboard
- `/kartlar` (Hesaplar)
- `/varliklar` hub → index (Varlıklar) + `/varliklar/maas` (Maaş) + `/varliklar/altin` (Altın) + `/varliklar/araclar` (Arabalarım)
- `/borclar` hub → `/borclar/krediler` (Krediler) + `/borclar/kisiler` (Kişiler) + `/borclar/kartlar` (Kart Borcu)
- `/odemeler` hub → index (Ödeme Takvimi) + `/odemeler/hedefler` (Bütçe & Hedefler) + `/odemeler/alsam-mi` (Alsam mı?) + `/odemeler/liste` (Alışveriş Listesi) + `/odemeler/baglamlar` (gider bağlamları)
- `/analiz` hub → index (Analiz) + `/analiz/detay` (Detay)
- `/veri-sagligi` hub → index (Bulgular) + `/veri-sagligi/islemler` (Yedek ve Ayarlar)
- `/login`

Redirects (not live pages):

- `/borclar` → `/borclar/krediler`
- `/alsam-mi` → `/odemeler/alsam-mi`
- `/analiz/araclar` → `/varliklar/araclar`
- `/analiz/trendler` → `/analiz`; `/analiz/servet`, `/analiz/kayitlar` → `/analiz/detay`
- `/krediler` → `/borclar/krediler`
- unknown paths (`*`) → `/`

All app routes except `/login` are protected by `ProtectedRoute`.

Navigation (`src/components/navigation.ts`): bottom bar (mobile, 5) = Özet · Hesaplar · Varlıklar · Borçlar · Plan; desktop rail adds Analiz and Kontrol; Analiz + Kontrol live in the mobile header overflow menu, Çıkış in the desktop rail footer.

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
- `card_current_settlements`
- `loans`
- `loan_installments`
- `debts`
- `payments`
- `transaction_history`
- `salary_history`
- `dismissed_upcoming_items`
- `card_ledger` / `account_ledger` (append-only signed-kuruş event ledgers; trigger/correction-RPC owned)
- `account_reconciliations` (bank-vs-app drift snapshots; `drift` immutable, resolution ayrı kolonda)
- `card_aliases` (SMS/import kart eşleme takma adları)
- `sms_log` (tanınmayan/işlenen SMS kayıtları)
- `push_subscriptions`, `notification_log` (Web Push abonelik + gönderim günlüğü)
- `net_worth_snapshots` (günlük net değer fotoğrafı)
- `gold_lots` (altın lot/ledger)
- `wishlist_items` (alışveriş listesi)
- `data_health_repair_runs` (canonical request, idempotency, batch status/counts)
- `data_health_repair_steps` (per-target before/after repair receipts)
- `data_health_issue_acknowledgements` (reversible per-user accepted issue IDs)
- `kasa_buckets` (kasa modu: bakiye kova ayırma — planlama overlay'i, ledger değil)
- `notification_preferences` (Web Push tür tercihleri + sessiz saatler; user_id PK)
- `cars`, `car_expenses`, `car_reminders` (saf araç gideri, yakıt ve bakım/yenileme merceği)
- `expense_contexts`, `context_expenses` (evcil hayvan / proje kart-dışı raporlama satırları)

Most rows are user-scoped with `user_id`. RLS is a core security assumption.
Data Health repair receipt tables grant authenticated users own-row SELECT only;
the security-definer repair/reset boundary owns their writes and cleanup.
Issue acknowledgements follow the same own-row read + auth-bound RPC write model
and are restored as user support preferences, never as finance history.

## Current Product Shape

This is not just a simple CRUD app anymore. It has evolved into:

- a personal ledger
- a monthly planning tool
- a credit card statement/installment tracker
- a purchase-decision ("alsam mı") support surface
- a data quality repair surface

Any new work should preserve that direction instead of reducing the app back to plain list management.
