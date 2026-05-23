alter table public.card_expenses
add column if not exists category text not null default 'Diğer',
add column if not exists installment_count integer not null default 1 check (installment_count between 1 and 36),
add column if not exists installment_amount numeric(14, 2) not null default 0 check (installment_amount >= 0);

update public.card_expenses
set installment_amount = amount
where installment_amount = 0;

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  month date not null default date_trunc('month', now())::date,
  category text not null,
  limit_amount numeric(14, 2) not null default 0 check (limit_amount >= 0),
  note text,
  unique (user_id, month, category)
);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  target_amount numeric(14, 2) not null default 0 check (target_amount >= 0),
  current_amount numeric(14, 2) not null default 0 check (current_amount >= 0),
  target_date date,
  status text not null default 'active' check (status in ('active', 'completed')),
  note text
);

create table if not exists public.card_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  card_expense_id uuid references public.card_expenses(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  installment_no integer not null check (installment_no > 0),
  installment_count integer not null check (installment_count between 1 and 36),
  due_month date not null,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  description text not null,
  category text not null default 'Diğer',
  status text not null default 'scheduled' check (status in ('scheduled', 'posted')),
  posted_at timestamptz,
  note text,
  unique (card_expense_id, installment_no)
);

create table if not exists public.card_statement_archives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  statement_date date not null default current_date,
  due_date date,
  statement_debt_amount numeric(14, 2) not null default 0 check (statement_debt_amount >= 0),
  current_period_spending numeric(14, 2) not null default 0 check (current_period_spending >= 0),
  total_debt_amount numeric(14, 2) not null default 0 check (total_debt_amount >= 0),
  note text
);

create index if not exists budgets_user_month_idx on public.budgets(user_id, month desc);
create index if not exists budgets_user_category_idx on public.budgets(user_id, category);
create index if not exists savings_goals_user_status_idx on public.savings_goals(user_id, status);
create index if not exists card_installments_user_due_month_idx on public.card_installments(user_id, due_month);
create index if not exists card_installments_card_due_month_idx on public.card_installments(card_id, due_month);
create index if not exists card_statement_archives_user_date_idx on public.card_statement_archives(user_id, statement_date desc);
create index if not exists card_statement_archives_card_date_idx on public.card_statement_archives(card_id, statement_date desc);

drop trigger if exists set_budgets_updated_at on public.budgets;
create trigger set_budgets_updated_at
before update on public.budgets
for each row execute function public.set_updated_at();

drop trigger if exists set_savings_goals_updated_at on public.savings_goals;
create trigger set_savings_goals_updated_at
before update on public.savings_goals
for each row execute function public.set_updated_at();

drop trigger if exists set_card_installments_updated_at on public.card_installments;
create trigger set_card_installments_updated_at
before update on public.card_installments
for each row execute function public.set_updated_at();

drop trigger if exists set_card_statement_archives_updated_at on public.card_statement_archives;
create trigger set_card_statement_archives_updated_at
before update on public.card_statement_archives
for each row execute function public.set_updated_at();

alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.card_installments enable row level security;
alter table public.card_statement_archives enable row level security;

grant select, insert, update, delete on table public.budgets to authenticated;
grant select, insert, update, delete on table public.savings_goals to authenticated;
grant select, insert, update, delete on table public.card_installments to authenticated;
grant select, insert, update, delete on table public.card_statement_archives to authenticated;

drop policy if exists "budgets_select_own" on public.budgets;
create policy "budgets_select_own" on public.budgets
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "budgets_insert_own" on public.budgets;
create policy "budgets_insert_own" on public.budgets
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "budgets_update_own" on public.budgets;
create policy "budgets_update_own" on public.budgets
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "budgets_delete_own" on public.budgets;
create policy "budgets_delete_own" on public.budgets
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "savings_goals_select_own" on public.savings_goals;
create policy "savings_goals_select_own" on public.savings_goals
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "savings_goals_insert_own" on public.savings_goals;
create policy "savings_goals_insert_own" on public.savings_goals
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "savings_goals_update_own" on public.savings_goals;
create policy "savings_goals_update_own" on public.savings_goals
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "savings_goals_delete_own" on public.savings_goals;
create policy "savings_goals_delete_own" on public.savings_goals
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "card_installments_select_own" on public.card_installments;
create policy "card_installments_select_own" on public.card_installments
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "card_installments_insert_own" on public.card_installments;
create policy "card_installments_insert_own" on public.card_installments
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "card_installments_update_own" on public.card_installments;
create policy "card_installments_update_own" on public.card_installments
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "card_installments_delete_own" on public.card_installments;
create policy "card_installments_delete_own" on public.card_installments
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "card_statement_archives_select_own" on public.card_statement_archives;
create policy "card_statement_archives_select_own" on public.card_statement_archives
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "card_statement_archives_insert_own" on public.card_statement_archives;
create policy "card_statement_archives_insert_own" on public.card_statement_archives
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "card_statement_archives_update_own" on public.card_statement_archives;
create policy "card_statement_archives_update_own" on public.card_statement_archives
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "card_statement_archives_delete_own" on public.card_statement_archives;
create policy "card_statement_archives_delete_own" on public.card_statement_archives
for delete to authenticated
using (user_id = (select auth.uid()));

drop function if exists public.add_card_expense(uuid, numeric, text, date);
drop function if exists public.add_card_expense(uuid, numeric, text, date, integer, text);

create or replace function public.add_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default current_date,
  p_installment_count integer default 1,
  p_category text default 'Diğer'
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_installment_count integer := greatest(1, least(coalesce(p_installment_count, 1), 36));
  v_installment_no integer;
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount <= 0 then
    raise exception 'Harcama tutari 0 dan buyuk olmali.';
  end if;

  if trim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama aciklamasi zorunlu.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

  if v_card.card_type = 'banka_karti' and v_card.current_balance < p_amount then
    raise exception 'Banka karti bakiyesi yetersiz.';
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + v_first_installment_amount,
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance - p_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  insert into public.card_expenses (
    user_id,
    card_id,
    spent_at,
    amount,
    description,
    category,
    installment_count,
    installment_amount
  )
  values (
    v_user_id,
    p_card_id,
    p_spent_at,
    p_amount,
    trim(p_description),
    coalesce(nullif(trim(coalesce(p_category, '')), ''), 'Diğer'),
    v_installment_count,
    v_first_installment_amount
  )
  returning * into v_expense;

  for v_installment_no in 1..v_installment_count loop
    v_installment_amount := round(p_amount / v_installment_count, 2);
    if v_installment_no = v_installment_count then
      v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
    end if;

    v_due_month := (date_trunc('month', p_spent_at)::date + ((v_installment_no - 1) * interval '1 month'))::date;

    insert into public.card_installments (
      user_id,
      card_id,
      card_expense_id,
      installment_no,
      installment_count,
      due_month,
      amount,
      description,
      category,
      status,
      posted_at
    )
    values (
      v_user_id,
      p_card_id,
      v_expense.id,
      v_installment_no,
      v_installment_count,
      v_due_month,
      v_installment_amount,
      trim(p_description),
      coalesce(nullif(trim(coalesce(p_category, '')), ''), 'Diğer'),
      case when v_installment_no = 1 then 'posted' else 'scheduled' end,
      case when v_installment_no = 1 then now() else null end
    );
  end loop;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    trim(p_description),
    p_amount,
    'card_expenses',
    v_expense.id,
    case
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcamasi.'
      else 'Kart harcamasi.'
    end
  );

  return v_expense;
end;
$$;

grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text) to authenticated;

create or replace function public.cut_card_statement(
  p_card_id uuid
)
returns public.card_statement_archives
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_archive public.card_statement_archives%rowtype;
  v_statement_total numeric(14, 2);
  v_due_month_start date;
  v_due_date date;
  v_due_day integer;
  v_next_period_start date := (date_trunc('month', current_date)::date + interval '1 month')::date;
  v_next_period_spending numeric(14, 2) := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstre sadece kredi karti icin kesilebilir.';
  end if;

  if v_card.current_period_spending <= 0 then
    raise exception 'Donem ici harcama olmadigi icin kesilecek ekstre yok.';
  end if;

  v_statement_total := v_card.statement_debt_amount + v_card.current_period_spending;

  if v_card.due_day is not null then
    v_due_month_start := date_trunc('month', current_date)::date;
    v_due_day := least(v_card.due_day, extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer);
    v_due_date := v_due_month_start + (v_due_day - 1);

    if v_due_date < current_date then
      v_due_month_start := (v_due_month_start + interval '1 month')::date;
      v_due_day := least(v_card.due_day, extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer);
      v_due_date := v_due_month_start + (v_due_day - 1);
    end if;
  end if;

  insert into public.card_statement_archives (
    user_id,
    card_id,
    statement_date,
    due_date,
    statement_debt_amount,
    current_period_spending,
    total_debt_amount,
    note
  )
  values (
    v_user_id,
    v_card.id,
    current_date,
    v_due_date,
    v_statement_total,
    v_card.current_period_spending,
    v_card.debt_amount,
    v_card.card_name || ' ekstresi kesildi.'
  )
  returning * into v_archive;

  select coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_installments
  where user_id = v_user_id
    and card_id = v_card.id
    and due_month = v_next_period_start
    and status = 'scheduled';

  update public.card_installments
  set status = 'posted',
      posted_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and due_month = v_next_period_start
    and status = 'scheduled';

  update public.cards
  set statement_debt_amount = v_statement_total,
      current_period_spending = v_next_period_spending,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    v_card.card_name || ' ekstresi kesildi',
    v_card.current_period_spending,
    'card_statement_archives',
    v_archive.id,
    'Dönem borcuna aktarıldı.'
  );

  return v_archive;
end;
$$;

grant execute on function public.cut_card_statement(uuid) to authenticated;
