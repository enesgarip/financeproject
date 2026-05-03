create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  category text not null check (category in ('Nakit', 'Altın', 'Fon', 'Hisse', 'Araç', 'BES', 'Diğer')),
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  unit text not null check (unit in ('TRY', 'gram', 'adet')),
  estimated_value_try numeric(14, 2) not null default 0 check (estimated_value_try >= 0),
  note text
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bank_name text not null,
  card_name text not null,
  card_type text not null check (card_type in ('banka_karti', 'kredi_karti', 'vadesiz_hesap')),
  current_balance numeric(14, 2) not null default 0,
  debt_amount numeric(14, 2) not null default 0 check (debt_amount >= 0),
  statement_day integer check (statement_day between 1 and 31),
  due_day integer check (due_day between 1 and 31),
  note text
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bank_name text not null,
  loan_name text not null,
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  remaining_amount numeric(14, 2) not null default 0 check (remaining_amount >= 0),
  monthly_payment numeric(14, 2) not null default 0 check (monthly_payment >= 0),
  installment_day integer check (installment_day between 1 and 31),
  start_date date,
  end_date date,
  remaining_installments integer not null default 0 check (remaining_installments >= 0),
  status text not null default 'active' check (status in ('active', 'closed')),
  note text
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  person_name text not null,
  direction text not null check (direction in ('borç_aldım', 'borç_verdim')),
  value_type text not null check (value_type in ('TRY', 'gram_altin', 'ceyrek_altin')),
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  estimated_value_try numeric(14, 2) not null default 0 check (estimated_value_try >= 0),
  due_date date,
  status text not null default 'açık' check (status in ('açık', 'kapandı')),
  note text
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  due_date date not null,
  status text not null default 'bekliyor' check (status in ('bekliyor', 'ödendi')),
  note text
);

create index if not exists assets_user_id_idx on public.assets(user_id);
create index if not exists cards_user_id_idx on public.cards(user_id);
create index if not exists loans_user_id_idx on public.loans(user_id);
create index if not exists debts_user_id_idx on public.debts(user_id);
create index if not exists payments_user_id_idx on public.payments(user_id);
create index if not exists debts_due_date_idx on public.debts(user_id, due_date);
create index if not exists payments_due_date_idx on public.payments(user_id, due_date);

drop trigger if exists set_assets_updated_at on public.assets;
create trigger set_assets_updated_at
before update on public.assets
for each row execute function public.set_updated_at();

drop trigger if exists set_cards_updated_at on public.cards;
create trigger set_cards_updated_at
before update on public.cards
for each row execute function public.set_updated_at();

drop trigger if exists set_loans_updated_at on public.loans;
create trigger set_loans_updated_at
before update on public.loans
for each row execute function public.set_updated_at();

drop trigger if exists set_debts_updated_at on public.debts;
create trigger set_debts_updated_at
before update on public.debts
for each row execute function public.set_updated_at();

drop trigger if exists set_payments_updated_at on public.payments;
create trigger set_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

alter table public.assets enable row level security;
alter table public.cards enable row level security;
alter table public.loans enable row level security;
alter table public.debts enable row level security;
alter table public.payments enable row level security;

drop policy if exists "assets_select_own" on public.assets;
create policy "assets_select_own" on public.assets
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "assets_insert_own" on public.assets;
create policy "assets_insert_own" on public.assets
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "assets_update_own" on public.assets;
create policy "assets_update_own" on public.assets
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "assets_delete_own" on public.assets;
create policy "assets_delete_own" on public.assets
for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "cards_select_own" on public.cards;
create policy "cards_select_own" on public.cards
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "cards_insert_own" on public.cards;
create policy "cards_insert_own" on public.cards
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "cards_update_own" on public.cards;
create policy "cards_update_own" on public.cards
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "cards_delete_own" on public.cards;
create policy "cards_delete_own" on public.cards
for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "loans_select_own" on public.loans;
create policy "loans_select_own" on public.loans
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "loans_insert_own" on public.loans;
create policy "loans_insert_own" on public.loans
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "loans_update_own" on public.loans;
create policy "loans_update_own" on public.loans
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "loans_delete_own" on public.loans;
create policy "loans_delete_own" on public.loans
for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "debts_select_own" on public.debts;
create policy "debts_select_own" on public.debts
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "debts_insert_own" on public.debts;
create policy "debts_insert_own" on public.debts
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "debts_update_own" on public.debts;
create policy "debts_update_own" on public.debts
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "debts_delete_own" on public.debts;
create policy "debts_delete_own" on public.debts
for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "payments_insert_own" on public.payments;
create policy "payments_insert_own" on public.payments
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "payments_update_own" on public.payments;
create policy "payments_update_own" on public.payments
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "payments_delete_own" on public.payments;
create policy "payments_delete_own" on public.payments
for delete to authenticated
using (user_id = auth.uid());
