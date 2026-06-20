-- Reconcile DenizBank current-movement imports with still-open planned payments.
-- This is the credit-card payment path from pay_payment, but the card expense
-- keeps the bank movement date instead of current_date.

drop function if exists public.pay_payment_from_card_import(uuid, uuid, numeric, date);

create or replace function public.pay_payment_from_card_import(
  p_payment_id uuid,
  p_source_card_id uuid,
  p_paid_amount numeric,
  p_spent_at date default current_date
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_payment public.payments%rowtype;
  v_paid_payment public.payments%rowtype;
  v_source public.cards%rowtype;
  v_paid_amount numeric(14, 2);
  v_spent_at date := coalesce(p_spent_at, current_date);
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

  v_paid_amount := round(coalesce(p_paid_amount, v_payment.amount), 2);

  if v_paid_amount <= 0 then
    raise exception 'Odeme tutari 0 dan buyuk olmali.';
  end if;

  select *
  into v_source
  from public.cards
  where id = p_source_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kaynak kart bulunamadi.';
  end if;

  if v_source.card_type <> 'kredi_karti' then
    raise exception 'Kart hareket importu yalniz kredi karti kaynagiyla kullanilir.';
  end if;

  if v_payment.auto_source_card_id is not null and v_payment.auto_source_card_id <> v_source.id then
    raise exception 'Odeme baska bir kredi kartina bagli.';
  end if;

  update public.cards
  set debt_amount = debt_amount + v_paid_amount,
      current_period_spending = current_period_spending + v_paid_amount,
      updated_at = now()
  where id = v_source.id;

  insert into public.card_expenses (
    user_id,
    card_id,
    spent_at,
    amount,
    description,
    category,
    installment_count,
    installment_amount,
    status,
    posted_at,
    note
  )
  values (
    v_user_id,
    v_source.id,
    v_spent_at,
    v_paid_amount,
    v_payment.title,
    v_payment.category,
    1,
    v_paid_amount,
    'posted',
    now(),
    'Odeme kaydindan import ile olusturuldu. Vade: '
      || to_char(v_payment.due_date, 'YYYY-MM-DD')
      || '. Banka hareket tarihi: '
      || to_char(v_spent_at, 'YYYY-MM-DD')
  );

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
      set amount = v_paid_amount,
          amount_status = 'exact',
          status = 'ödendi',
          updated_at = now()
      where id = v_payment.id
      returning * into v_paid_payment;
    else
      update public.payments
      set amount = v_paid_amount,
          amount_status = case
            when v_payment.payment_method = 'bank_auto' or v_payment.amount_status = 'estimated' then 'estimated'
            else 'exact'
          end,
          due_date = v_next_due_date,
          status = 'bekliyor',
          updated_at = now()
      where id = v_payment.id
      returning * into v_paid_payment;
    end if;
  else
    update public.payments
    set amount = v_paid_amount,
        amount_status = 'exact',
        status = 'ödendi',
        updated_at = now()
    where id = v_payment.id
    returning * into v_paid_payment;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_payment.title || ' odendi',
    v_paid_amount,
    'payments',
    v_payment.id,
    v_source.card_name
      || ' kredi kartina DenizBank hareket importundan harcama olarak islendi. Vade: '
      || to_char(v_payment.due_date, 'YYYY-MM-DD')
      || '. Banka hareket tarihi: '
      || to_char(v_spent_at, 'YYYY-MM-DD')
  );

  return v_paid_payment;
end;
$$;

revoke execute on function public.pay_payment_from_card_import(uuid, uuid, numeric, date) from public;
revoke execute on function public.pay_payment_from_card_import(uuid, uuid, numeric, date) from anon;
grant execute on function public.pay_payment_from_card_import(uuid, uuid, numeric, date) to authenticated;
