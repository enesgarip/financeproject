-- SMS hesap hareketi retry tekilleştirme ve zaman dilimi regresyonu.
begin;

-- Fixture kurulumu DB owner olarak yapılır; service_role bu tablolara doğrudan
-- yazamaz ve yalnız dar SECURITY DEFINER RPC'yi çalıştırabilir.
insert into public.cards (
  id, user_id, bank_name, card_name, card_type, account_number, current_balance
)
values (
  'b0000000-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Test', 'SMS hesap idempotency', 'banka_karti', '4230-99999999-001', 0
);

set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  perform public.record_sms_account_movement(
    '99999999-001', 125, 'in', 'Test Gonderici',
    '2026-08-02T09:13:00+03:00', 'FAST', v_user, 'sms-account-event-1'
  );
  perform public.record_sms_account_movement(
    '99999999-001', 125, 'in', 'Test Gonderici',
    '2026-08-02T09:13:00+03:00', 'FAST', v_user, 'sms-account-event-1'
  );

  -- Aynı işlem alanları ama farklı provider olayı: gerçek ikinci hareket.
  perform public.record_sms_account_movement(
    '99999999-001', 125, 'in', 'Test Gonderici',
    '2026-08-02T09:13:00+03:00', 'FAST', v_user, 'sms-account-event-2'
  );
end $$;

reset role;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid := 'b0000000-0000-4000-8000-000000000001';
  v_balance numeric;
  v_count integer;
  v_occurred_at timestamptz;
begin
  select current_balance into v_balance from public.cards where id = v_card;
  if v_balance <> 250 then
    raise exception 'FAIL retry/ikinci hareket bakiye: 250 bekleniyordu, %', v_balance;
  end if;

  select count(*), max(occurred_at)
  into v_count, v_occurred_at
  from public.transaction_history
  where user_id = v_user and source_event_id = 'sms-account-event-1';
  if v_count <> 1 then
    raise exception 'FAIL retry history: 1 bekleniyordu, %', v_count;
  end if;
  if v_occurred_at <> '2026-08-02T06:13:00Z'::timestamptz then
    raise exception 'FAIL SMS saat dilimi: 06:13Z bekleniyordu, %', v_occurred_at;
  end if;

  select count(*) into v_count
  from public.account_ledger
  where card_id = v_card and kind = 'deposit';
  if v_count <> 2 then
    raise exception 'FAIL retry/ikinci hareket ledger: 2 bekleniyordu, %', v_count;
  end if;

  if has_function_privilege(
    'authenticated',
    'public.record_sms_account_movement(text,numeric,text,text,timestamptz,text,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL grant: authenticated SMS account RPC calistiramamali.';
  end if;

  raise notice 'SMS hesap idempotency regresyonu OK.';
end $$;

rollback;
