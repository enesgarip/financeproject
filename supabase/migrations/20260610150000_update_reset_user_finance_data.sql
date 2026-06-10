-- Keep the full-data reset RPC aligned with tables added after the original
-- data-reset migration. Deletes run child-first so FK checks stay quiet.

create or replace function public.reset_user_finance_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  delete from public.dismissed_upcoming_items where user_id = v_user_id;
  delete from public.account_reconciliations where user_id = v_user_id;
  delete from public.card_installments where user_id = v_user_id;
  delete from public.card_statement_archives where user_id = v_user_id;
  delete from public.card_expenses where user_id = v_user_id;
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

grant execute on function public.reset_user_finance_data() to authenticated;
