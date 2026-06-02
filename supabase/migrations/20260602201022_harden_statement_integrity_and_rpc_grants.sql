do $$
begin
  if exists (
    select 1
    from public.card_statement_archives
    where period_year is not null
      and period_month is not null
    group by user_id, card_id, period_year, period_month
    having count(*) > 1
  ) then
    raise exception 'Duplicate card statement archive periods exist. Resolve duplicates before applying v1.0 hardening.';
  end if;
end $$;

create unique index if not exists card_statement_archives_user_card_period_uidx
on public.card_statement_archives(user_id, card_id, period_year, period_month);

drop policy if exists "card_expenses_insert_own" on public.card_expenses;
create policy "card_expenses_insert_own" on public.card_expenses
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.cards
    where cards.id = card_expenses.card_id
      and cards.user_id = (select auth.uid())
  )
);

drop policy if exists "card_expenses_update_own" on public.card_expenses;
create policy "card_expenses_update_own" on public.card_expenses
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.cards
    where cards.id = card_expenses.card_id
      and cards.user_id = (select auth.uid())
  )
);

drop policy if exists "card_installments_insert_own" on public.card_installments;
create policy "card_installments_insert_own" on public.card_installments
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.cards
    where cards.id = card_installments.card_id
      and cards.user_id = (select auth.uid())
  )
  and (
    card_expense_id is null
    or exists (
      select 1
      from public.card_expenses
      where card_expenses.id = card_installments.card_expense_id
        and card_expenses.user_id = (select auth.uid())
        and card_expenses.card_id = card_installments.card_id
    )
  )
);

drop policy if exists "card_installments_update_own" on public.card_installments;
create policy "card_installments_update_own" on public.card_installments
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.cards
    where cards.id = card_installments.card_id
      and cards.user_id = (select auth.uid())
  )
  and (
    card_expense_id is null
    or exists (
      select 1
      from public.card_expenses
      where card_expenses.id = card_installments.card_expense_id
        and card_expenses.user_id = (select auth.uid())
        and card_expenses.card_id = card_installments.card_id
    )
  )
  and (
    statement_archive_id is null
    or exists (
      select 1
      from public.card_statement_archives
      where card_statement_archives.id = card_installments.statement_archive_id
        and card_statement_archives.user_id = (select auth.uid())
        and card_statement_archives.card_id = card_installments.card_id
    )
  )
);

drop policy if exists "card_statement_archives_insert_own" on public.card_statement_archives;
create policy "card_statement_archives_insert_own" on public.card_statement_archives
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.cards
    where cards.id = card_statement_archives.card_id
      and cards.user_id = (select auth.uid())
  )
  and (
    payment_source_card_id is null
    or exists (
      select 1
      from public.cards
      where cards.id = card_statement_archives.payment_source_card_id
        and cards.user_id = (select auth.uid())
    )
  )
);

drop policy if exists "card_statement_archives_update_own" on public.card_statement_archives;
create policy "card_statement_archives_update_own" on public.card_statement_archives
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.cards
    where cards.id = card_statement_archives.card_id
      and cards.user_id = (select auth.uid())
  )
  and (
    payment_source_card_id is null
    or exists (
      select 1
      from public.cards
      where cards.id = card_statement_archives.payment_source_card_id
        and cards.user_id = (select auth.uid())
    )
  )
);

drop policy if exists "loan_installments_insert_own" on public.loan_installments;
create policy "loan_installments_insert_own" on public.loan_installments
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.loans
    where loans.id = loan_installments.loan_id
      and loans.user_id = (select auth.uid())
  )
);

drop policy if exists "loan_installments_update_own" on public.loan_installments;
create policy "loan_installments_update_own" on public.loan_installments
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.loans
    where loans.id = loan_installments.loan_id
      and loans.user_id = (select auth.uid())
  )
);

drop policy if exists "savings_goal_components_insert_own" on public.savings_goal_components;
create policy "savings_goal_components_insert_own" on public.savings_goal_components
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.savings_goals
    where savings_goals.id = savings_goal_components.goal_id
      and savings_goals.user_id = (select auth.uid())
  )
);

drop policy if exists "savings_goal_components_update_own" on public.savings_goal_components;
create policy "savings_goal_components_update_own" on public.savings_goal_components
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.savings_goals
    where savings_goals.id = savings_goal_components.goal_id
      and savings_goals.user_id = (select auth.uid())
  )
);

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
  v_statement_amount numeric(14, 2);
  v_due_month_start date;
  v_due_date date;
  v_due_day integer;
  v_period_year integer := extract(year from current_date)::integer;
  v_period_month integer := extract(month from current_date)::integer;
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

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_card.id::text || ':' || v_period_year::text || ':' || v_period_month::text, 0)
  );

  select *
  into v_archive
  from public.card_statement_archives
  where user_id = v_user_id
    and card_id = v_card.id
    and period_year = v_period_year
    and period_month = v_period_month
  order by created_at desc
  limit 1;

  if found then
    return v_archive;
  end if;

  if v_card.current_period_spending <= 0 then
    raise exception 'Donem ici harcama olmadigi icin kesilecek ekstre yok.';
  end if;

  v_statement_amount := v_card.current_period_spending;

  if v_card.due_day is not null then
    v_due_month_start := date_trunc('month', current_date)::date;
    if v_card.statement_day is not null and v_card.due_day <= v_card.statement_day then
      v_due_month_start := (v_due_month_start + interval '1 month')::date;
    end if;

    v_due_day := least(v_card.due_day, extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer);
    v_due_date := v_due_month_start + (v_due_day - 1);
  end if;

  insert into public.card_statement_archives (
    user_id,
    card_id,
    period_year,
    period_month,
    statement_date,
    due_date,
    statement_debt_amount,
    current_period_spending,
    total_debt_amount,
    status,
    note
  )
  values (
    v_user_id,
    v_card.id,
    v_period_year,
    v_period_month,
    current_date,
    v_due_date,
    v_statement_amount,
    v_statement_amount,
    v_card.debt_amount,
    'open',
    v_card.card_name || ' ekstresi kesildi.'
  )
  returning * into v_archive;

  update public.card_expenses
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and installment_count <= 1
    and spent_at <= current_date;

  update public.card_installments
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month <= date_trunc('month', current_date)::date;

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
  set statement_debt_amount = statement_debt_amount + v_statement_amount,
      current_period_spending = v_next_period_spending,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    v_card.card_name || ' ekstresi kesildi',
    v_statement_amount,
    'card_statement_archives',
    v_archive.id,
    'Donem borcu ekstreye aktarildi. Kredi karti taksitleri ayri borc olarak eklenmedi.'
  );

  return v_archive;
end;
$$;

grant execute on function public.cut_card_statement(uuid) to authenticated;

create or replace function public.cut_due_card_statements()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card record;
  v_count integer := 0;
  v_today_day integer := extract(day from current_date)::integer;
  v_period_year integer := extract(year from current_date)::integer;
  v_period_month integer := extract(month from current_date)::integer;
  v_month_last_day integer := extract(day from (date_trunc('month', current_date)::date + interval '1 month - 1 day'))::integer;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  for v_card in
    select cards.id, cards.statement_day
    from public.cards
    where cards.user_id = v_user_id
      and cards.card_type = 'kredi_karti'
      and cards.current_period_spending > 0
      and cards.statement_day is not null
      and least(cards.statement_day, v_month_last_day) <= v_today_day
      and not exists (
        select 1
        from public.card_statement_archives
        where card_statement_archives.user_id = v_user_id
          and card_statement_archives.card_id = cards.id
          and card_statement_archives.period_year = v_period_year
          and card_statement_archives.period_month = v_period_month
      )
  loop
    perform public.cut_card_statement(v_card.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.cut_due_card_statements() to authenticated;

revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text) to authenticated;
grant execute on function public.cancel_card_provision(uuid) to authenticated;
grant execute on function public.cut_card_statement(uuid) to authenticated;
grant execute on function public.cut_due_card_statements() to authenticated;
grant execute on function public.post_card_provision(uuid, numeric) to authenticated;
grant execute on function public.pay_card_debt(uuid, uuid, numeric) to authenticated;
grant execute on function public.pay_card_statement(uuid, uuid) to authenticated;
grant execute on function public.pay_card_installment(uuid, uuid) to authenticated;
grant execute on function public.unpay_card_installment(uuid) to authenticated;
grant execute on function public.pay_loan_installment(uuid, uuid) to authenticated;
grant execute on function public.unpay_loan_installment(uuid) to authenticated;
grant execute on function public.pay_payment(uuid, uuid, numeric) to authenticated;
grant execute on function public.settle_personal_debt(uuid, uuid) to authenticated;
grant execute on function public.transfer_between_accounts(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.update_card_expense(uuid, numeric, text, date, integer, text, text) to authenticated;
grant execute on function public.reset_user_finance_data() to authenticated;
