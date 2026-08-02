-- Keep full backup/restore/reset aligned with user-owned tables added in July.
-- Current-settlement allocations form a RESTRICT cycle with their child rows;
-- the reset RPC opens a transaction-local, user-bound bypass while deleting
-- children first. Normal update/delete protection remains unchanged.

drop policy if exists "card_current_settlements_insert_own" on public.card_current_settlements;
revoke insert on table public.card_current_settlements from authenticated;
drop function if exists public.restore_card_current_settlement(jsonb);

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
  and (
    current_settlement_id is null
    or exists (
      select 1
      from public.card_current_settlements settlement
      where settlement.id = card_expenses.current_settlement_id
        and settlement.user_id = (select auth.uid())
        and settlement.card_id = card_expenses.card_id
    )
  )
  and (
    statement_archive_id is null
    or exists (
      select 1
      from public.card_statement_archives archive
      where archive.id = card_expenses.statement_archive_id
        and archive.user_id = (select auth.uid())
        and archive.card_id = card_expenses.card_id
    )
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
  and (
    current_settlement_id is null
    or exists (
      select 1
      from public.card_current_settlements settlement
      where settlement.id = card_expenses.current_settlement_id
        and settlement.user_id = (select auth.uid())
        and settlement.card_id = card_expenses.card_id
    )
  )
  and (
    statement_archive_id is null
    or exists (
      select 1
      from public.card_statement_archives archive
      where archive.id = card_expenses.statement_archive_id
        and archive.user_id = (select auth.uid())
        and archive.card_id = card_expenses.card_id
    )
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
  and (
    current_settlement_id is null
    or exists (
      select 1
      from public.card_current_settlements settlement
      where settlement.id = card_installments.current_settlement_id
        and settlement.user_id = (select auth.uid())
        and settlement.card_id = card_installments.card_id
    )
  )
  and (
    statement_archive_id is null
    or exists (
      select 1
      from public.card_statement_archives archive
      where archive.id = card_installments.statement_archive_id
        and archive.user_id = (select auth.uid())
        and archive.card_id = card_installments.card_id
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
  and (
    current_settlement_id is null
    or exists (
      select 1
      from public.card_current_settlements settlement
      where settlement.id = card_installments.current_settlement_id
        and settlement.user_id = (select auth.uid())
        and settlement.card_id = card_installments.card_id
    )
  )
);

drop policy if exists "card_current_settlements_delete_during_reset" on public.card_current_settlements;
revoke delete on table public.card_current_settlements from authenticated;

create or replace function private.guard_current_settlement_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is not null
     and coalesce(current_setting('app.finance_data_reset_user_id', true), '') = v_user_id::text then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_table_name = 'card_expenses' then
    if old.current_settlement_id is not null
       or exists (
         select 1
         from public.card_installments
         where card_expense_id = old.id
           and current_settlement_id is not null
       ) then
      raise exception 'Erken ödemeyle kapanmış kart harcaması değiştirilemez veya silinemez.';
    end if;
  elsif old.current_settlement_id is not null then
    raise exception 'Erken ödemeyle kapanmış kart taksiti değiştirilemez veya silinemez.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.reset_user_finance_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  -- Serialize the reset with card-scoped pay/cut/edit/cancel operations. A
  -- deterministic order avoids lock-order inversions when the user has more
  -- than one account/card.
  perform id
  from public.cards
  where user_id = v_user_id
  order by id
  for update;

  -- Independent/support rows that are part of a full user backup.
  delete from public.notification_preferences where user_id = v_user_id;
  delete from public.push_subscriptions where user_id = v_user_id;
  delete from public.wishlist_items where user_id = v_user_id;
  delete from public.kasa_buckets where user_id = v_user_id;
  delete from public.dismissed_upcoming_items where user_id = v_user_id;

  -- Settlement children must be removed before their RESTRICT parent. The
  -- transaction-local flag is bound to auth.uid() and is cleared immediately
  -- after the cycle has been removed.
  perform set_config('app.finance_data_reset_user_id', v_user_id::text, true);
  delete from public.notification_log where user_id = v_user_id;
  delete from public.sms_log where user_id = v_user_id;
  delete from public.account_reconciliations where user_id = v_user_id;
  delete from public.card_installments where user_id = v_user_id;
  delete from public.card_expenses where user_id = v_user_id;
  delete from public.card_statement_archives where user_id = v_user_id;
  delete from public.card_current_settlements where user_id = v_user_id;
  perform set_config('app.finance_data_reset_user_id', '', true);

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

revoke all on function public.reset_user_finance_data() from public;
revoke all on function public.reset_user_finance_data() from anon;
grant execute on function public.reset_user_finance_data() to authenticated;
