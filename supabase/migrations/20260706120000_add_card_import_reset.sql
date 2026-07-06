-- Import-only card reset.
--
-- The old reset_card_data RPC is intentionally destructive: it removes all card
-- expenses, installments, statement archives, and related history. Statement and
-- current-movement imports need a narrower baseline reset so the current data can
-- be rebuilt from a bank file without wiping historical paid statements used by
-- reports.

create or replace function public.reset_card_import_data(
  p_card_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_archive_ids uuid[] := array[]::uuid[];
  v_expense_ids uuid[] := array[]::uuid[];
  v_installment_ids uuid[] := array[]::uuid[];
  v_boundary date;
  v_this_boundary date;
  v_prev_month_start date;
  v_period_year integer;
  v_period_month integer;
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

  if v_card.card_type = 'kredi_karti' and v_card.statement_day is not null then
    v_this_boundary := make_date(
      extract(year from current_date)::integer,
      extract(month from current_date)::integer,
      least(
        v_card.statement_day,
        extract(day from (date_trunc('month', current_date)::date + interval '1 month - 1 day'))::integer
      )
    );

    if current_date > v_this_boundary then
      v_boundary := v_this_boundary;
    else
      v_prev_month_start := (date_trunc('month', current_date) - interval '1 month')::date;
      v_boundary := make_date(
        extract(year from v_prev_month_start)::integer,
        extract(month from v_prev_month_start)::integer,
        least(
          v_card.statement_day,
          extract(day from (v_prev_month_start + interval '1 month - 1 day'))::integer
        )
      );
    end if;
  else
    v_boundary := current_date;
  end if;

  v_period_year := extract(year from v_boundary)::integer;
  v_period_month := extract(month from v_boundary)::integer;

  select coalesce(array_agg(id), array[]::uuid[])
  into v_archive_ids
  from public.card_statement_archives
  where card_id = p_card_id
    and user_id = v_user_id
    and (
      coalesce(status, 'open') <> 'paid'
      or (period_year = v_period_year and period_month = v_period_month)
    );

  select coalesce(array_agg(id), array[]::uuid[])
  into v_expense_ids
  from public.card_expenses
  where card_id = p_card_id
    and user_id = v_user_id
    and (
      statement_archive_id is null
      or statement_archive_id = any(v_archive_ids)
    );

  select coalesce(array_agg(id), array[]::uuid[])
  into v_installment_ids
  from public.card_installments
  where card_id = p_card_id
    and user_id = v_user_id
    and (
      statement_archive_id is null
      or statement_archive_id = any(v_archive_ids)
      or card_expense_id = any(v_expense_ids)
    );

  delete from public.transaction_history
  where user_id = v_user_id
    and (
      (source_table = 'card_expenses' and source_id = any(v_expense_ids))
      or (source_table = 'card_installments' and source_id = any(v_installment_ids))
      or (source_table = 'card_statement_archives' and source_id = any(v_archive_ids))
    );

  delete from public.card_installments
  where id = any(v_installment_ids)
    and user_id = v_user_id;

  delete from public.card_expenses
  where id = any(v_expense_ids)
    and user_id = v_user_id;

  delete from public.card_statement_archives
  where id = any(v_archive_ids)
    and user_id = v_user_id;

  update public.cards
  set debt_amount = 0,
      statement_debt_amount = 0,
      current_period_spending = 0,
      provision_amount = 0,
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;
end;
$$;

revoke execute on function public.reset_card_import_data(uuid) from anon;
revoke execute on function public.reset_card_import_data(uuid) from public;
grant execute on function public.reset_card_import_data(uuid) to authenticated;
