-- Planli odeme nakit veya uygulamada izlenmeyen baska bir kaynaktan
-- yapildiginda odeme kaydini ilerlet/kapat, ancak hicbir hesap ya da kart
-- bakiyesini degistirme. Mevcut hesap/kredi karti davranisi korunur.

drop function if exists public.pay_payment(uuid, uuid, numeric, date);

create or replace function public.pay_payment(
  p_payment_id uuid,
  p_source_card_id uuid default null,
  p_paid_amount numeric default null,
  p_paid_at date default null,
  p_outside_accounts boolean default false
)
returns public.payments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_payment public.payments%rowtype;
  v_paid_payment public.payments%rowtype;
  v_source public.cards%rowtype;
  v_paid_amount numeric(14, 2);
  v_paid_on date := coalesce(p_paid_at, private.today_ist());
  v_occurred_at timestamptz := private.paid_at_timestamp(p_paid_at);
  v_next_month_start date;
  v_next_month_end date;
  v_next_due_day integer;
  v_next_due_date date;
  v_history_note text;
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

  if p_outside_accounts then
    if p_source_card_id is not null then
      raise exception 'Hesap disi odemede kaynak hesap secilmemeli.';
    end if;
    v_history_note := 'Nakit / hesap disi odendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD');
  else
    if p_source_card_id is null then
      raise exception 'Kaynak hesap bulunamadi.';
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

    if v_source.card_type = 'banka_karti' then
      v_source := private.debit_bank_account(p_source_card_id, v_paid_amount);
      v_history_note := v_source.card_name || ' hesabindan odendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD');
    elsif v_source.card_type = 'kredi_karti' then
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
        note,
        source,
        source_event_id
      )
      values (
        v_user_id,
        v_source.id,
        v_paid_on,
        v_paid_amount,
        v_payment.title,
        private.card_category_from_payment(v_payment.category),
        1,
        v_paid_amount,
        'posted',
        v_occurred_at,
        'Odeme kaydindan olusturuldu. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD'),
        'payment_auto',
        'payment:' || v_payment.id::text || ':' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS')
      );
      v_history_note := v_source.card_name || ' kredi kartina harcama olarak islendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD');
    else
      raise exception 'Kaynak kart tipi desteklenmiyor.';
    end if;
  end if;

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

  if p_paid_at is not null and p_paid_at <> private.today_ist() then
    v_history_note := v_history_note || ' Odeme gunu: ' || to_char(p_paid_at, 'YYYY-MM-DD');
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note, occurred_at)
  values (
    v_user_id,
    'payment',
    v_payment.title || ' odendi',
    v_paid_amount,
    'payments',
    v_payment.id,
    v_history_note,
    v_occurred_at
  );

  return v_paid_payment;
end;
$function$;

revoke execute on function public.pay_payment(uuid, uuid, numeric, date, boolean) from public;
revoke execute on function public.pay_payment(uuid, uuid, numeric, date, boolean) from anon;
grant execute on function public.pay_payment(uuid, uuid, numeric, date, boolean) to authenticated;
