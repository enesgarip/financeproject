-- Cancel any card expense (provision or posted) and reverse its effect on card balances.
-- Unlike cancel_card_provision which only handles provisions, this works for any status.

-- Extend the transaction_history type check to include 'correction'.
alter table public.transaction_history
drop constraint if exists transaction_history_type_check;

alter table public.transaction_history
add constraint transaction_history_type_check
check (type in ('payment', 'transfer', 'loan', 'debt', 'card', 'correction'));

create or replace function public.cancel_card_expense(
  p_expense_id uuid
)
returns public.card_expenses
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_cancelled public.card_expenses%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Harcama bulunamadi.';
  end if;

  if v_expense.status = 'cancelled' then
    raise exception 'Bu harcama zaten iptal edilmis.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_expense.card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = greatest(0, debt_amount - v_expense.amount),
        current_period_spending = greatest(0, current_period_spending - v_expense.amount),
        provision_amount = case
          when v_expense.status = 'provision'
          then greatest(0, provision_amount - v_expense.amount)
          else provision_amount
        end,
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance + v_expense.amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  delete from public.card_installments
  where card_expense_id = v_expense.id
    and user_id = v_user_id;

  update public.card_expenses
  set status = 'cancelled',
      updated_at = now()
  where id = v_expense.id
  returning * into v_cancelled;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'correction',
    v_expense.description || ' iptal edildi',
    v_expense.amount,
    'card_expenses',
    v_expense.id,
    'Mutabakat sirasinda iptal edildi. Orijinal tarih: ' || to_char(v_expense.spent_at, 'YYYY-MM-DD')
  );

  return v_cancelled;
end;
$$;

revoke execute on function public.cancel_card_expense(uuid) from public;
revoke execute on function public.cancel_card_expense(uuid) from anon;
grant execute on function public.cancel_card_expense(uuid) to authenticated;
