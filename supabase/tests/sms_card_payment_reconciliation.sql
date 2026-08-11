-- Kart SMS'i ile planlı kredi kartı otomatik ödemesinin çapraz-kaynak
-- tekilleştirme regresyonu.
begin;

insert into public.cards (
  id, user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day
)
values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Test', 'SMS once', 'kredi_karti', 50000, 25, 10),
  ('c1000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Test', 'Auto once', 'kredi_karti', 50000, 25, 10);

insert into public.payments (
  id, user_id, title, category, amount, amount_status, due_date, status,
  payment_method, recurrence, recurrence_day, auto_source_card_id
)
values
  ('a1000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Su', 'Fatura', 385, 'estimated', current_date, 'bekliyor', 'bank_auto', 'monthly', extract(day from current_date)::integer, 'c1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Internet', 'Fatura', 685, 'estimated', current_date - 1, 'bekliyor', 'bank_auto', 'monthly', extract(day from current_date - 1)::integer, 'c1000000-0000-4000-8000-000000000002');

-- SMS önce: aynı webhook retry yalnız bir provizyon üretir ve planı ilerletir.
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  perform public.record_sms_card_expense(
    'c1000000-0000-4000-8000-000000000001', 385, 'BUSKI', now(),
    'Fatura', v_user, 'sms-card-event-1'
  );
  perform public.record_sms_card_expense(
    'c1000000-0000-4000-8000-000000000001', 385, 'BUSKI', now(),
    'Fatura', v_user, 'sms-card-event-1'
  );
end $$;

reset role;

do $$
declare
  v_count integer;
  v_debt numeric;
  v_provision numeric;
  v_due_date date;
begin
  select count(*) into v_count
  from public.card_expenses
  where card_id = 'c1000000-0000-4000-8000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL SMS-first expense count: 1 bekleniyordu, %', v_count;
  end if;

  select debt_amount, provision_amount into v_debt, v_provision
  from public.cards where id = 'c1000000-0000-4000-8000-000000000001';
  if v_debt <> 385 or v_provision <> 385 then
    raise exception 'FAIL SMS-first card totals: debt/provision 385 bekleniyordu, %/%', v_debt, v_provision;
  end if;

  select due_date into v_due_date
  from public.payments where id = 'a1000000-0000-4000-8000-000000000001';
  if v_due_date <= current_date then
    raise exception 'FAIL SMS-first payment ilerlemedi: %', v_due_date;
  end if;

  select count(*) into v_count
  from public.transaction_history
  where source_table = 'payments'
    and source_id = 'a1000000-0000-4000-8000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL SMS-first payment history: 1 bekleniyordu, %', v_count;
  end if;
end $$;

-- BM-5: proaktif fallback yok (post_due_card_auto_payments drop edildi).
-- Geciken talimat da SMS geldiğinde kapanır: dünkü vadeli plan SMS'le eşleşir,
-- tek harcama yazılır ve plan ilerler.
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  perform public.record_sms_card_expense(
    'c1000000-0000-4000-8000-000000000002', 685, 'TURKNET', now() - interval '1 day',
    'Fatura', v_user, 'sms-card-event-2'
  );
end $$;

reset role;

do $$
declare
  v_count integer;
  v_debt numeric;
  v_source text;
  v_event_id text;
  v_due_date date;
begin
  select count(*), max(source), max(source_event_id)
  into v_count, v_source, v_event_id
  from public.card_expenses
  where card_id = 'c1000000-0000-4000-8000-000000000002';

  if v_count <> 1 or v_source <> 'sms' or v_event_id <> 'sms-card-event-2' then
    raise exception 'FAIL geciken talimat eşleme: count/source/event 1/sms/event bekleniyordu, %/%/%', v_count, v_source, v_event_id;
  end if;

  select debt_amount into v_debt
  from public.cards where id = 'c1000000-0000-4000-8000-000000000002';
  if v_debt <> 685 then
    raise exception 'FAIL geciken talimat borcu tek yazılmalıydı: 685 bekleniyordu, %', v_debt;
  end if;

  select due_date into v_due_date
  from public.payments where id = 'a1000000-0000-4000-8000-000000000002';
  if v_due_date <= current_date then
    raise exception 'FAIL geciken talimat planı ilerlemedi: %', v_due_date;
  end if;

  -- BM-5: proaktif yazan RPC tamamen kaldırıldı.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'post_due_card_auto_payments'
  ) then
    raise exception 'FAIL BM-5: post_due_card_auto_payments hâlâ mevcut.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.record_sms_card_expense(uuid,numeric,text,timestamptz,text,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL grant: authenticated SMS kart RPC çalıştıramamalı.';
  end if;

  raise notice 'SMS kart/planlı ödeme eşleme regresyonu OK (BM-5: SMS tek yazar).';
end $$;

rollback;
