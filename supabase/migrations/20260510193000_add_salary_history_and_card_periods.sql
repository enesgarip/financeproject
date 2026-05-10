alter table public.loan_installments
alter column id set default gen_random_uuid();

alter table public.transaction_history
alter column id set default gen_random_uuid();

alter table public.dismissed_upcoming_items
alter column id set default gen_random_uuid();

alter table public.cards
add column if not exists holder_name text,
add column if not exists limit_group_name text,
add column if not exists statement_debt_amount numeric(14, 2) not null default 0 check (statement_debt_amount >= 0),
add column if not exists current_period_spending numeric(14, 2) not null default 0 check (current_period_spending >= 0);

update public.cards
set statement_debt_amount = debt_amount
where card_type = 'kredi_karti'
  and statement_debt_amount = 0
  and debt_amount > 0;

create table if not exists public.salary_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null default 'Maaş',
  amount numeric(14, 2) not null check (amount >= 0),
  effective_date date not null,
  note text
);

create index if not exists salary_history_user_effective_date_idx on public.salary_history(user_id, effective_date desc);

drop trigger if exists set_salary_history_updated_at on public.salary_history;
create trigger set_salary_history_updated_at
before update on public.salary_history
for each row execute function public.set_updated_at();

alter table public.salary_history enable row level security;

drop policy if exists "salary_history_select_own" on public.salary_history;
create policy "salary_history_select_own" on public.salary_history
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "salary_history_insert_own" on public.salary_history;
create policy "salary_history_insert_own" on public.salary_history
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "salary_history_update_own" on public.salary_history;
create policy "salary_history_update_own" on public.salary_history
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "salary_history_delete_own" on public.salary_history;
create policy "salary_history_delete_own" on public.salary_history
for delete to authenticated
using (user_id = (select auth.uid()));
