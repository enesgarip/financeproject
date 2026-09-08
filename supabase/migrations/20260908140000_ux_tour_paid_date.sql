-- UX turu 2026-09-08 akış paketi (docs/UX_WALKTHROUGH_2026-09-08.md B9):
-- Ödeme diyaloğu tarihi planlanan gün gösteriyor, gerçek ödeme günü
-- girilemiyordu. pay_payment ve pay_loan_installment artık isteğe bağlı
-- p_paid_at (date) alır: kart harcamasının spent_at'i, taksitin paid_at'i ve
-- işlem geçmişi occurred_at'i o güne yazılır. Boş bırakılırsa bugün (Istanbul).
-- Gelecek tarih reddedilir. Eski imzalar DROP edilir; default'lu yeni imza
-- 2/3 argümanlı çağrıları PostgREST üzerinden karşılamaya devam eder.

-- ---------------------------------------------------------------------------
-- Ortak: ödeme günü → geçmiş zaman damgası (öğlen, Istanbul)
-- ---------------------------------------------------------------------------
create or replace function private.paid_at_timestamp(p_paid_at date)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_paid_at is null then
    return now();
  end if;
  if p_paid_at > private.today_ist() then
    raise exception 'Odeme tarihi gelecekte olamaz.';
  end if;
  -- Ödeme günü bugünse gerçek anı koru (sıralama/undo yığını için).
  if p_paid_at = private.today_ist() then
    return now();
  end if;
  return (p_paid_at + time '12:00') at time zone 'Europe/Istanbul';
end;
$$;

-- ---------------------------------------------------------------------------
-- pay_payment(p_paid_at)
-- ---------------------------------------------------------------------------
drop function if exists public.pay_payment(uuid, uuid, numeric);

CREATE OR REPLACE FUNCTION public.pay_payment(
  p_payment_id uuid,
  p_source_card_id uuid,
  p_paid_amount numeric DEFAULT NULL::numeric,
  p_paid_at date DEFAULT NULL::date
)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Read the source card to determine bank vs credit card path.
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
    -- Bank path: delegate to shared helper (re-lock is a no-op).
    v_source := private.debit_bank_account(p_source_card_id, v_paid_amount);
  elsif v_source.card_type = 'kredi_karti' then
    -- Credit card path: add as card spending (different logic, stays inline).
    update public.cards
    set debt_amount = debt_amount + v_paid_amount,
        current_period_spending = current_period_spending + v_paid_amount,
        updated_at = now()
    where id = v_source.id;

    -- Kategori kart taksonomisine eşlenir (B5); source/source_event_id ile
    -- "kartla ödenen planlı ödeme" aylık raporda nakit çıkışı sayılmaz (B4).
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
  else
    raise exception 'Kaynak kart tipi desteklenmiyor.';
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

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note, occurred_at)
  values (
    v_user_id,
    'payment',
    v_payment.title || ' odendi',
    v_paid_amount,
    'payments',
    v_payment.id,
    case
      when v_source.card_type = 'kredi_karti'
        then v_source.card_name || ' kredi kartina harcama olarak islendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
      else v_source.card_name || ' hesabindan odendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
    end
      || case when p_paid_at is not null and p_paid_at <> private.today_ist()
           then ' Odeme gunu: ' || to_char(p_paid_at, 'YYYY-MM-DD') else '' end,
    v_occurred_at
  );

  return v_paid_payment;
end;
$function$
;

revoke execute on function public.pay_payment(uuid, uuid, numeric, date) from public;
revoke execute on function public.pay_payment(uuid, uuid, numeric, date) from anon;
grant execute on function public.pay_payment(uuid, uuid, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- pay_loan_installment(p_paid_at)
-- ---------------------------------------------------------------------------
drop function if exists public.pay_loan_installment(uuid, uuid);

create or replace function public.pay_loan_installment(
  p_installment_id uuid,
  p_source_card_id uuid,
  p_paid_at date default null
)
returns public.loan_installments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_installment public.loan_installments%rowtype;
  v_paid_installment public.loan_installments%rowtype;
  v_loan public.loans%rowtype;
  v_source public.cards%rowtype;
  v_remaining_amount numeric(14, 2);
  v_remaining_installments integer;
  v_paid_at timestamptz := private.paid_at_timestamp(p_paid_at);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_installment
  from public.loan_installments
  where id = p_installment_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Taksit bulunamadi.';
  end if;

  if v_installment.status = 'ödendi' then
    raise exception 'Bu taksit zaten odendi.';
  end if;

  if v_installment.amount <= 0 then
    raise exception 'Taksit tutari 0 dan buyuk olmali.';
  end if;

  -- Denetim §2: taksitler sırayla tahsil edilir.
  if exists (
    select 1
    from public.loan_installments
    where loan_id = v_installment.loan_id
      and user_id = v_user_id
      and status = 'bekliyor'
      and installment_no < v_installment.installment_no
  ) then
    raise exception 'Once siradaki taksit odenmeli: % numarali taksitten once bekleyen taksit var.', v_installment.installment_no;
  end if;

  select *
  into v_loan
  from public.loans
  where id = v_installment.loan_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kredi bulunamadi.';
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_installment.amount);

  update public.loan_installments
  set status = 'ödendi',
      paid_at = v_paid_at,
      updated_at = now()
  where id = v_installment.id
  returning * into v_paid_installment;

  select coalesce(sum(amount), 0), count(*)::integer
  into v_remaining_amount, v_remaining_installments
  from public.loan_installments
  where loan_id = v_loan.id
    and status <> 'ödendi';

  update public.loans
  set remaining_amount = v_remaining_amount,
      remaining_installments = v_remaining_installments,
      status = case when v_remaining_installments = 0 then 'closed' else 'active' end,
      updated_at = now()
  where id = v_loan.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note, occurred_at)
  values (
    v_user_id,
    'loan',
    v_loan.loan_name || ' ' || v_installment.installment_no || '. taksit odemesi',
    v_installment.amount,
    'loan_installments',
    v_installment.id,
    v_source.card_name || ' hesabindan odendi. Vade: ' || to_char(v_installment.due_date, 'YYYY-MM-DD')
      || case when p_paid_at is not null and p_paid_at <> private.today_ist()
           then ' Odeme gunu: ' || to_char(p_paid_at, 'YYYY-MM-DD') else '' end,
    v_paid_at
  );

  return v_paid_installment;
end;
$$;

revoke execute on function public.pay_loan_installment(uuid, uuid, date) from public;
revoke execute on function public.pay_loan_installment(uuid, uuid, date) from anon;
grant execute on function public.pay_loan_installment(uuid, uuid, date) to authenticated;
