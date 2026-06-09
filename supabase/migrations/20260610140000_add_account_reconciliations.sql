-- Live balance reconciliation (roadmap A3) — the periodic ritual the app lacked.
--
-- Distinct from statement reconciliation (card_statement_archives.reconciled_*),
-- which checks an ARCHIVED statement against the bank's statement total. This
-- checks the LIVE figure right now: a bank account's current_balance, or a
-- credit card's current debt_amount, against what the user reads in their
-- banking app. Each row is one reconciliation event — a snapshot of the app
-- figure, the real figure, and the drift between them — so the app can show
-- "last reconciled N days ago" and a drift trend. Drift kayan rakam = manuel
-- finans takibinin 1 numaralı terk sebebi; bu ritüel onu görünür kılar.

create table if not exists public.account_reconciliations (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  card_id       uuid        not null references public.cards(id) on delete cascade,
  reconciled_at timestamptz not null default now(),
  target        text        not null check (target in ('balance', 'debt')),
  app_amount    numeric(14, 2) not null,
  real_amount   numeric(14, 2) not null,
  drift         numeric(14, 2) not null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.account_reconciliations enable row level security;

grant select, insert, update, delete on table public.account_reconciliations to authenticated;

drop policy if exists "account_reconciliations_select_own" on public.account_reconciliations;
create policy "account_reconciliations_select_own"
  on public.account_reconciliations for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "account_reconciliations_insert_own" on public.account_reconciliations;
create policy "account_reconciliations_insert_own"
  on public.account_reconciliations for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "account_reconciliations_update_own" on public.account_reconciliations;
create policy "account_reconciliations_update_own"
  on public.account_reconciliations for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "account_reconciliations_delete_own" on public.account_reconciliations;
create policy "account_reconciliations_delete_own"
  on public.account_reconciliations for delete
  to authenticated
  using (user_id = (select auth.uid()));

create index if not exists account_reconciliations_card_idx
  on public.account_reconciliations (user_id, card_id, reconciled_at desc);

create trigger account_reconciliations_updated_at
  before update on public.account_reconciliations
  for each row execute function public.touch_updated_at();
