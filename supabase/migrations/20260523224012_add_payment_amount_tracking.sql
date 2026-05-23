alter table public.payments
add column if not exists payment_method text not null default 'manual',
add column if not exists amount_status text not null default 'exact';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_payment_method_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_payment_method_check
    check (payment_method in ('manual', 'bank_auto'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_amount_status_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_amount_status_check
    check (amount_status in ('exact', 'estimated'));
  end if;
end $$;

drop function if exists public.pay_payment(uuid, uuid);
drop function if exists public.pay_payment(uuid, uuid, numeric);

create or replace function public.pay_payment(
  p_payment_id uuid,
  p_source_card_id uuid,
  p_paid_amount numeric default null
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
  v_paid_amount numeric(14, 2);
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
    raise exception 'Kaynak hesap bulunamadi.';
  end if;

  if v_source.card_type <> 'banka_karti' then
    raise exception 'Kaynak hesap banka karti olmali.';
  end if;

  if v_source.current_balance < v_paid_amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance - v_paid_amount,
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
    v_payment.title || ' ödendi',
    v_paid_amount,
    'payments',
    v_payment.id,
    v_source.card_name || ' hesabindan odendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
  );

  return v_paid_payment;
end;
$$;

grant execute on function public.pay_payment(uuid, uuid, numeric) to authenticated;
