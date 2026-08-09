begin;

insert into public.cards (
  id, user_id, bank_name, card_name, card_type, credit_limit,
  debt_amount, statement_debt_amount, current_period_spending, provision_amount,
  statement_day, due_day, current_balance
) values
  ('c2000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Test', 'Banka snapshot', 'kredi_karti', 10000, 500, 0, 50, 0, 15, 25, 0),
  ('c2000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Test', 'Kaynak hesap', 'banka_karti', 0, 0, 0, 0, 0, null, null, 1000);

insert into public.card_statement_archives (
  id, user_id, card_id, period_year, period_month, statement_date, due_date,
  statement_debt_amount, current_period_spending, total_debt_amount,
  status, paid_at, payment_source_card_id
) values (
  'a2000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
  'c2000000-0000-4000-8000-000000000001', 2001, 1,
  current_date - 20, current_date - 10, 400, 400, 500,
  'paid', now() - interval '10 days', 'c2000000-0000-4000-8000-000000000002'
);

insert into public.card_expenses (
  id, user_id, card_id, amount, description, spent_at, installment_count,
  installment_amount, category, status, statement_archive_id
) values
  ('e2000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c2000000-0000-4000-8000-000000000001', 100, 'Bağlı eski hareket', current_date - 25,
   1, 100, 'Diğer', 'posted', 'a2000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'c2000000-0000-4000-8000-000000000001', 200, 'Eski taksit parent', current_date - 50,
   2, 100, 'Diğer', 'posted', null),
  ('e2000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'c2000000-0000-4000-8000-000000000001', 200, 'Eski peşin', current_date - 22,
   1, 200, 'Diğer', 'posted', null),
  ('e2000000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111',
   'c2000000-0000-4000-8000-000000000001', 50, 'Yeni dönem', current_date,
   1, 50, 'Diğer', 'posted', null);

insert into public.card_installments (
  id, user_id, card_id, card_expense_id, installment_no, installment_count,
  due_month, amount, description, category, status, posted_at
) values (
  'd2000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
  'c2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002',
  1, 2, current_date - 21, 100, 'Eski taksit', 'Diğer', 'posted', now() - interval '21 days'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_debt numeric;
begin
  select public.reconcile_card_bank_snapshot(
    'c2000000-0000-4000-8000-000000000001', 55000,
    'Banka toplam kalan kart yükü'
  ) into v_debt;

  if v_debt <> 550 then
    raise exception 'FAIL banka toplamı: 550 bekleniyordu, %', v_debt;
  end if;
end $$;

reset role;

do $$
declare
  v_count integer;
  v_current numeric;
  v_debt numeric;
  v_bucket_delta bigint;
begin
  select count(*) into v_count
  from public.card_expenses
  where id = 'e2000000-0000-4000-8000-000000000003'
    and statement_archive_id = 'a2000000-0000-4000-8000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL eski peşin arşive bağlanmadı.';
  end if;

  select count(*) into v_count
  from public.card_installments
  where id = 'd2000000-0000-4000-8000-000000000001'
    and statement_archive_id = 'a2000000-0000-4000-8000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL eski taksit arşive bağlanmadı.';
  end if;

  select debt_amount, current_period_spending into v_debt, v_current
  from public.cards where id = 'c2000000-0000-4000-8000-000000000001';
  if v_debt <> 550 or v_current <> 50 then
    raise exception 'FAIL toplam-only düzeltme: borç/current 550/50 bekleniyordu, %/%', v_debt, v_current;
  end if;

  select current_delta_kurus into v_bucket_delta
  from public.card_ledger
  where card_id = 'c2000000-0000-4000-8000-000000000001'
    and kind = 'adjustment'
    and note = 'Banka toplam kalan kart yükü'
  order by occurred_at desc, id desc
  limit 1;
  if v_bucket_delta <> 0 then
    raise exception 'FAIL toplam-only ledger current deltası 0 olmalı, %', v_bucket_delta;
  end if;
end $$;

-- Tarihsel artıklar arşivlendiği için tam dönem ödemesi güvenlik kontrolünden geçer.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  perform public.pay_card_debt(
    'c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000002',
    50
  );
end $$;

reset role;

do $$
declare
  v_debt numeric;
  v_current numeric;
  v_balance numeric;
begin
  select debt_amount, current_period_spending into v_debt, v_current
  from public.cards where id = 'c2000000-0000-4000-8000-000000000001';
  select current_balance into v_balance
  from public.cards where id = 'c2000000-0000-4000-8000-000000000002';

  if v_debt <> 500 or v_current <> 0 or v_balance <> 950 then
    raise exception 'FAIL ödeme sonrası debt/current/balance 500/0/950 bekleniyordu, %/%/%', v_debt, v_current, v_balance;
  end if;

  raise notice 'Kart banka snapshot mutabakat regresyonu OK.';
end $$;

rollback;
