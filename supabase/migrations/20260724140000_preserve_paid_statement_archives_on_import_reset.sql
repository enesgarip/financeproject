-- Clean imports may rebuild only the open/current working scope.
-- A paid statement is historical evidence and must never be selected for
-- deletion, even when it belongs to the current statement period.

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
  v_archive_ids uuid[] := array[]::uuid[];
  v_expense_ids uuid[] := array[]::uuid[];
  v_installment_ids uuid[] := array[]::uuid[];
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  perform 1
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  select coalesce(array_agg(id), array[]::uuid[])
  into v_archive_ids
  from public.card_statement_archives
  where card_id = p_card_id
    and user_id = v_user_id
    and coalesce(status, 'open') <> 'paid';

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
