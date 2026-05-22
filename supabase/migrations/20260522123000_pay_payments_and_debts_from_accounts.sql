create or replace function public.pay_payment(
  p_payment_id uuid,
  p_source_card_id uuid
)
returns public.payments
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_payment public.payments%rowtype;
  v_paid_payment public.payments%rowtype;
  v_source public.cards%rowtype;
  v_next_month_start date;
  v_next_month_end date;
  v_next_due_day integer;
  v_next_due_date date;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_payment
  from public.payments
  where id = p_payment_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Odeme bulunamadi.';
  end if;

  if v_payment.status <> 'bekliyor' then
    raise exception 'Bu odeme bekliyor durumunda degil.';
  end if;

  if v_payment.amount <= 0 then
    raise exception 'Odeme tutari 0 dan buyuk olmali.';
  end if;

  select *
  into v_source
  from public.cards
  where id = p_source_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kaynak hesap bulunamadi.';
  end if;

  if v_source.card_type <> 'banka_karti' then
    raise exception 'Kaynak hesap banka karti olmali.';
  end if;

  if v_source.current_balance < v_payment.amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance - v_payment.amount,
      updated_at = now()
  where id = v_source.id;

  if v_payment.recurrence = 'monthly' then
    v_next_month_start := (date_trunc('month', v_payment.due_date)::date + interval '1 month')::date;
    v_next_month_end := (date_trunc('month', v_next_month_start)::date + interval '1 month - 1 day')::date;
    v_next_due_day := least(
      coalesce(v_payment.recurrence_day, extract(day from v_payment.due_date)::integer),
      extract(day from v_next_month_end)::integer
    );
    v_next_due_date := v_next_month_start + (v_next_due_day - 1);

    if v_payment.recurrence_end_date is not null and v_next_due_date > v_payment.recurrence_end_date then
      update public.payments
      set status = 'ödendi',
          updated_at = now()
      where id = v_payment.id
      returning * into v_paid_payment;
    else
      update public.payments
      set due_date = v_next_due_date,
          status = 'bekliyor',
          updated_at = now()
      where id = v_payment.id
      returning * into v_paid_payment;
    end if;
  else
    update public.payments
    set status = 'ödendi',
        updated_at = now()
    where id = v_payment.id
    returning * into v_paid_payment;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_payment.title || ' ödendi',
    v_payment.amount,
    'payments',
    v_payment.id,
    v_source.card_name || ' hesabından ödendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
  );

  return v_paid_payment;
end;
$$;

grant execute on function public.pay_payment(uuid, uuid) to authenticated;

create or replace function public.settle_personal_debt(
  p_debt_id uuid,
  p_account_card_id uuid
)
returns public.debts
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_debt public.debts%rowtype;
  v_closed_debt public.debts%rowtype;
  v_account public.cards%rowtype;
  v_delta numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_debt
  from public.debts
  where id = p_debt_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Borc kaydi bulunamadi.';
  end if;

  if v_debt.status <> 'açık' then
    raise exception 'Bu borc kaydi acik durumda degil.';
  end if;

  if v_debt.estimated_value_try <= 0 then
    raise exception 'Borc tutari 0 dan buyuk olmali.';
  end if;

  select *
  into v_account
  from public.cards
  where id = p_account_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Hesap bulunamadi.';
  end if;

  if v_account.card_type <> 'banka_karti' then
    raise exception 'Hesap banka karti olmali.';
  end if;

  v_delta := case when v_debt.direction = 'borç_aldım' then -v_debt.estimated_value_try else v_debt.estimated_value_try end;

  if v_delta < 0 and v_account.current_balance < abs(v_delta) then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance + v_delta,
      updated_at = now()
  where id = v_account.id;

  update public.debts
  set status = 'kapandı',
      updated_at = now()
  where id = v_debt.id
  returning * into v_closed_debt;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'debt',
    v_debt.person_name || ' borç kaydı kapandı',
    v_debt.estimated_value_try,
    'debts',
    v_debt.id,
    case
      when v_debt.direction = 'borç_aldım' then v_account.card_name || ' hesabından ödendi.'
      else v_account.card_name || ' hesabına tahsil edildi.'
    end
  );

  return v_closed_debt;
end;
$$;

grant execute on function public.settle_personal_debt(uuid, uuid) to authenticated;
