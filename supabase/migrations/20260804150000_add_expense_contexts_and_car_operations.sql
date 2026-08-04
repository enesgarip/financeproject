-- Bağlamlar + Arabalarım v2.
-- Bütün yeni para alanları raporlama annotation'ıdır; ledger, kart borcu, net değer
-- ve nakit akışı projeksiyonlarına katılmaz.

alter table public.cars
  add column current_odometer_km integer null
    check (current_odometer_km is null or current_odometer_km >= 0);

alter table public.car_expenses
  add column fuel_liters numeric null
    check (fuel_liters is null or fuel_liters > 0),
  add column odometer_km integer null
    check (odometer_km is null or odometer_km >= 0);

alter table public.card_expenses
  add column fuel_liters numeric null
    check (fuel_liters is null or fuel_liters > 0),
  add column odometer_km integer null
    check (odometer_km is null or odometer_km >= 0);

drop policy if exists "own rows" on public.car_expenses;
create policy "own rows" on public.car_expenses
  for all using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.cars
      where cars.id = car_expenses.car_id
        and cars.user_id = (select auth.uid())
    )
  );

create table public.car_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  car_id uuid not null references public.cars(id) on delete cascade,
  title text not null,
  kind text not null default 'bakim'
    check (kind in ('bakim', 'mtv', 'muayene', 'sigorta', 'kasko', 'lastik', 'diger')),
  due_date date null,
  due_odometer_km integer null check (due_odometer_km is null or due_odometer_km >= 0),
  repeat_months integer null check (repeat_months is null or repeat_months > 0),
  repeat_km integer null check (repeat_km is null or repeat_km > 0),
  note text null,
  check (due_date is not null or due_odometer_km is not null)
);

create index car_reminders_user_idx on public.car_reminders (user_id);
create index car_reminders_car_idx on public.car_reminders (car_id);
create index car_reminders_due_date_idx on public.car_reminders (due_date)
  where due_date is not null;

alter table public.car_reminders enable row level security;
create policy "own rows" on public.car_reminders
  for all using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.cars
      where cars.id = car_reminders.car_id
        and cars.user_id = (select auth.uid())
    )
  );
create trigger set_updated_at before update on public.car_reminders
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on table public.car_reminders to authenticated;

create table public.expense_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('pet', 'project')),
  name text not null,
  budget_amount numeric null check (budget_amount is null or budget_amount >= 0),
  starts_on date null,
  ends_on date null,
  sort_order integer not null default 0,
  note text null,
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index expense_contexts_user_idx on public.expense_contexts (user_id);
alter table public.expense_contexts enable row level security;
create policy "own rows" on public.expense_contexts
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create trigger set_updated_at before update on public.expense_contexts
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on table public.expense_contexts to authenticated;

create table public.context_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  context_id uuid not null references public.expense_contexts(id) on delete cascade,
  spent_at date not null default current_date,
  amount numeric not null check (amount > 0),
  category text not null default 'Diğer',
  payment_method text not null default 'nakit'
    check (payment_method in ('nakit', 'banka', 'diger')),
  description text not null default '',
  note text null
);

create index context_expenses_user_idx on public.context_expenses (user_id);
create index context_expenses_context_idx on public.context_expenses (context_id);
alter table public.context_expenses enable row level security;
create policy "own rows" on public.context_expenses
  for all using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.expense_contexts
      where expense_contexts.id = context_expenses.context_id
        and expense_contexts.user_id = (select auth.uid())
    )
  );
create trigger set_updated_at before update on public.context_expenses
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on table public.context_expenses to authenticated;

alter table public.card_expenses
  add column context_id uuid null references public.expense_contexts(id) on delete set null;
create index card_expenses_context_idx on public.card_expenses (context_id)
  where context_id is not null;

create or replace function private.guard_card_expense_reporting_tags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.car_id is not null and not exists (
    select 1 from public.cars where id = new.car_id and user_id = new.user_id
  ) then
    raise exception 'Araç etiketi kullanıcıya ait değil.';
  end if;
  if new.context_id is not null and not exists (
    select 1 from public.expense_contexts where id = new.context_id and user_id = new.user_id
  ) then
    raise exception 'Gider bağlamı kullanıcıya ait değil.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_card_expense_reporting_tags() from public, anon, authenticated;

create trigger guard_card_expense_reporting_tags
  before insert or update of car_id, context_id on public.card_expenses
  for each row execute function private.guard_card_expense_reporting_tags();

-- Araç hatırlatıcılarını mevcut bildirim tercih kapısına bağla.
alter table public.notification_preferences
  add column cars_enabled boolean not null default true;

-- Backup/reset kapsamındaki bütün yeni satırları child-first temizle. Bu tanım,
-- önceki atomik reset davranışını aynen korur ve Arabalarım v1 eksik kapsamını da kapatır.
create or replace function public.reset_user_finance_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Oturum bulunamadı.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 1647595321)
  );

  perform id from public.cards where user_id = v_user_id order by id for update;

  delete from public.data_health_issue_acknowledgements where user_id = v_user_id;
  delete from public.data_health_repair_runs where user_id = v_user_id;
  delete from public.notification_preferences where user_id = v_user_id;
  delete from public.push_subscriptions where user_id = v_user_id;
  delete from public.wishlist_items where user_id = v_user_id;
  delete from public.kasa_buckets where user_id = v_user_id;
  delete from public.dismissed_upcoming_items where user_id = v_user_id;
  delete from public.context_expenses where user_id = v_user_id;
  delete from public.expense_contexts where user_id = v_user_id;
  delete from public.car_reminders where user_id = v_user_id;
  delete from public.car_expenses where user_id = v_user_id;

  perform set_config('app.finance_data_reset_user_id', v_user_id::text, true);
  delete from public.notification_log where user_id = v_user_id;
  delete from public.sms_log where user_id = v_user_id;
  delete from public.account_reconciliations where user_id = v_user_id;
  delete from public.card_installments where user_id = v_user_id;
  delete from public.card_expenses where user_id = v_user_id;
  delete from public.card_statement_archives where user_id = v_user_id;
  delete from public.card_current_settlements where user_id = v_user_id;
  perform set_config('app.finance_data_reset_user_id', '', true);

  delete from public.cars where user_id = v_user_id;
  delete from public.card_aliases where user_id = v_user_id;
  delete from public.loan_installments where user_id = v_user_id;
  delete from public.savings_goal_components where user_id = v_user_id;
  delete from public.transaction_history where user_id = v_user_id;
  delete from public.payments where user_id = v_user_id;
  delete from public.budgets where user_id = v_user_id;
  delete from public.net_worth_snapshots where user_id = v_user_id;
  delete from public.gold_lots where user_id = v_user_id;
  delete from public.savings_goals where user_id = v_user_id;
  delete from public.salary_history where user_id = v_user_id;
  delete from public.debts where user_id = v_user_id;
  delete from public.loans where user_id = v_user_id;
  delete from public.cards where user_id = v_user_id;
  delete from public.assets where user_id = v_user_id;
end;
$$;

revoke all on function public.reset_user_finance_data() from public, anon;
grant execute on function public.reset_user_finance_data() to authenticated;
