-- reset_user_finance_data: stock_trades kapsamı (20260908180000 devamı).
--
-- stock_trades.asset_id FK'sı `on delete set null` (varlık silinse de tarihçe
-- kalsın); dolayısıyla assets silinince satırlar CASCADE ile gitmez. Tam
-- sıfırlama (ve onun üstüne kurulan transaksiyonel restore) bu tabloyu açıkça
-- silmeli — aksi halde restore aynı id'leri eklerken PK çakışması verir
-- (supabase/tests/transactional_restore.sql bunu yakaladı).
-- Gövde 20260819110000'deki sürümle BİREBİR aynıdır; tek ek stock_trades delete.

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
  delete from public.card_installment_intents where user_id = v_user_id;
  delete from public.card_installments where user_id = v_user_id;
  delete from public.card_expenses where user_id = v_user_id;
  delete from public.card_statement_payments where user_id = v_user_id;
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
  delete from public.stock_trades where user_id = v_user_id;
  delete from public.assets where user_id = v_user_id;
end;
$$;

revoke all on function public.reset_user_finance_data() from public;
revoke all on function public.reset_user_finance_data() from anon;
grant execute on function public.reset_user_finance_data() to authenticated;
