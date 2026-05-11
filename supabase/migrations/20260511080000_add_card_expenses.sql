create table if not exists public.card_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  spent_at date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  description text not null check (length(btrim(description)) > 0),
  note text
);

create index if not exists card_expenses_user_spent_at_idx on public.card_expenses(user_id, spent_at desc);
create index if not exists card_expenses_card_spent_at_idx on public.card_expenses(card_id, spent_at desc);

drop trigger if exists set_card_expenses_updated_at on public.card_expenses;
create trigger set_card_expenses_updated_at
before update on public.card_expenses
for each row execute function public.set_updated_at();

alter table public.card_expenses enable row level security;

drop policy if exists "card_expenses_select_own" on public.card_expenses;
create policy "card_expenses_select_own" on public.card_expenses
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "card_expenses_insert_own" on public.card_expenses;
create policy "card_expenses_insert_own" on public.card_expenses
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "card_expenses_update_own" on public.card_expenses;
create policy "card_expenses_update_own" on public.card_expenses
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "card_expenses_delete_own" on public.card_expenses;
create policy "card_expenses_delete_own" on public.card_expenses
for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function public.add_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default current_date
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
declare
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_description text := nullif(btrim(p_description), '');
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutari 0 dan buyuk olmali.';
  end if;

  if v_description is null then
    raise exception 'Aciklama zorunlu.';
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

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + p_amount
    where id = v_card.id;
  else
    if v_card.current_balance < p_amount then
      raise exception 'Banka karti bakiyesi yetersiz.';
    end if;

    update public.cards
    set current_balance = current_balance - p_amount
    where id = v_card.id;
  end if;

  insert into public.card_expenses (user_id, card_id, spent_at, amount, description)
  values (v_user_id, v_card.id, coalesce(p_spent_at, current_date), p_amount, v_description)
  returning * into v_expense;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    v_card.card_name || ' harcama',
    p_amount,
    'card_expenses',
    v_expense.id,
    v_description
  );

  return v_expense;
end;
$$;

grant execute on function public.add_card_expense(uuid, numeric, text, date) to authenticated;
