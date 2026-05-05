create table if not exists public.loan_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  loan_id uuid not null references public.loans(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  installment_no integer not null check (installment_no > 0),
  due_date date not null,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  status text not null default 'bekliyor' check (status in ('bekliyor', 'ödendi')),
  paid_at timestamptz,
  note text,
  unique (loan_id, installment_no)
);

create table if not exists public.transaction_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  occurred_at timestamptz not null default now(),
  type text not null check (type in ('payment', 'transfer', 'loan', 'debt', 'card')),
  title text not null,
  amount numeric(14, 2) check (amount is null or amount >= 0),
  source_table text,
  source_id uuid,
  note text
);

create table if not exists public.dismissed_upcoming_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  item_key text not null,
  source text not null check (source in ('payment', 'card', 'loan_installment', 'debt')),
  unique (user_id, item_key)
);

create index if not exists loan_installments_user_due_date_idx on public.loan_installments(user_id, due_date);
create index if not exists loan_installments_loan_id_idx on public.loan_installments(loan_id);
create index if not exists transaction_history_user_occurred_at_idx on public.transaction_history(user_id, occurred_at desc);
create index if not exists dismissed_upcoming_items_user_key_idx on public.dismissed_upcoming_items(user_id, item_key);

drop trigger if exists set_loan_installments_updated_at on public.loan_installments;
create trigger set_loan_installments_updated_at
before update on public.loan_installments
for each row execute function public.set_updated_at();

drop trigger if exists set_transaction_history_updated_at on public.transaction_history;
create trigger set_transaction_history_updated_at
before update on public.transaction_history
for each row execute function public.set_updated_at();

alter table public.loan_installments enable row level security;
alter table public.transaction_history enable row level security;
alter table public.dismissed_upcoming_items enable row level security;

drop policy if exists "loan_installments_select_own" on public.loan_installments;
create policy "loan_installments_select_own" on public.loan_installments
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "loan_installments_insert_own" on public.loan_installments;
create policy "loan_installments_insert_own" on public.loan_installments
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "loan_installments_update_own" on public.loan_installments;
create policy "loan_installments_update_own" on public.loan_installments
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "loan_installments_delete_own" on public.loan_installments;
create policy "loan_installments_delete_own" on public.loan_installments
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "transaction_history_select_own" on public.transaction_history;
create policy "transaction_history_select_own" on public.transaction_history
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "transaction_history_insert_own" on public.transaction_history;
create policy "transaction_history_insert_own" on public.transaction_history
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "transaction_history_update_own" on public.transaction_history;
create policy "transaction_history_update_own" on public.transaction_history
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "transaction_history_delete_own" on public.transaction_history;
create policy "transaction_history_delete_own" on public.transaction_history
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "dismissed_upcoming_items_select_own" on public.dismissed_upcoming_items;
create policy "dismissed_upcoming_items_select_own" on public.dismissed_upcoming_items
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "dismissed_upcoming_items_insert_own" on public.dismissed_upcoming_items;
create policy "dismissed_upcoming_items_insert_own" on public.dismissed_upcoming_items
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "dismissed_upcoming_items_update_own" on public.dismissed_upcoming_items;
create policy "dismissed_upcoming_items_update_own" on public.dismissed_upcoming_items
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "dismissed_upcoming_items_delete_own" on public.dismissed_upcoming_items;
create policy "dismissed_upcoming_items_delete_own" on public.dismissed_upcoming_items
for delete to authenticated
using (user_id = (select auth.uid()));
