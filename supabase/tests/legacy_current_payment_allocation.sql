begin;

insert into public.cards (
  id, user_id, bank_name, card_name, card_type, credit_limit,
  debt_amount, statement_debt_amount, current_period_spending, provision_amount,
  statement_day, due_day, current_balance
) values
  ('c3000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Test', 'Legacy allocation', 'kredi_karti', 100000, 83614.83, 0, 20168.53, 0,
   extract(day from current_date)::integer, 24, 0),
  ('c3000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Test', 'Kaynak hesap', 'banka_karti', 0, 0, 0, 0, 0, null, null, 25000),
  ('c3000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Test', 'Belirsiz legacy', 'kredi_karti', 1000, 100, 0, 50, 0,
   extract(day from current_date)::integer, 24, 0);

insert into public.card_expenses (
  id, user_id, card_id, amount, description, spent_at, installment_count,
  installment_amount, category, status
) values
  ('e3000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 734.01, 'Eski alışveriş', current_date - 100,
   3, 244.67, 'Diğer', 'posted'),
  ('e3000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 31833.99, 'Eski dyson', current_date - 130,
   9, 3537.11, 'Diğer', 'posted'),
  ('e3000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 146998.98, 'Eski bilgisayar', current_date - 160,
   9, 16333.22, 'Diğer', 'posted'),
  ('e3000000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 894.59, 'Güncel alışveriş', current_date - 45,
   3, 298.20, 'Diğer', 'posted'),
  ('e3000000-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000003', 80, 'Belirsiz eski', current_date - 80,
   2, 40, 'Diğer', 'posted'),
  ('e3000000-0000-4000-8000-000000000006', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000003', 98, 'Eksik güncel', current_date - 20,
   2, 49, 'Diğer', 'posted');

insert into public.card_installments (
  id, user_id, card_id, card_expense_id, installment_no, installment_count,
  due_month, amount, description, category, status, posted_at
) values
  ('d3000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   3, 3, current_date - 39, 244.67, 'Eski alışveriş', 'Diğer', 'posted', now() - interval '39 days'),
  ('d3000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002',
   4, 9, current_date - 39, 3537.11, 'Eski dyson', 'Diğer', 'posted', now() - interval '39 days'),
  ('d3000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000003',
   5, 9, current_date - 39, 16333.22, 'Eski bilgisayar', 'Diğer', 'posted', now() - interval '39 days'),
  ('d3000000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000004',
   2, 3, current_date - 13, 298.20, 'Güncel alışveriş', 'Diğer', 'posted', now() - interval '13 days'),
  ('d3000000-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002',
   5, 9, current_date - 8, 3537.11, 'Güncel dyson', 'Diğer', 'posted', now() - interval '8 days'),
  ('d3000000-0000-4000-8000-000000000006', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000003',
   6, 9, current_date - 8, 16333.22, 'Güncel bilgisayar', 'Diğer', 'posted', now() - interval '8 days'),
  ('d3000000-0000-4000-8000-000000000007', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000005',
   1, 2, current_date - 50, 40, 'Belirsiz eski', 'Diğer', 'posted', now() - interval '50 days'),
  ('d3000000-0000-4000-8000-000000000008', '11111111-1111-1111-1111-111111111111',
   'c3000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000006',
   1, 2, current_date - 10, 49, 'Eksik güncel', 'Diğer', 'posted', now() - interval '10 days');

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  perform public.pay_card_debt(
    'c3000000-0000-4000-8000-000000000001',
    'c3000000-0000-4000-8000-000000000002',
    20168.53
  );
end $$;

reset role;

do $$
declare
  v_debt numeric;
  v_current numeric;
  v_balance numeric;
  v_repair_count integer;
  v_repair_amount numeric;
  v_old_paid integer;
  v_current_paid integer;
begin
  select debt_amount, current_period_spending into v_debt, v_current
  from public.cards where id = 'c3000000-0000-4000-8000-000000000001';
  select current_balance into v_balance
  from public.cards where id = 'c3000000-0000-4000-8000-000000000002';

  select count(*), max(amount) into v_repair_count, v_repair_amount
  from public.card_current_settlements
  where card_id = 'c3000000-0000-4000-8000-000000000001'
    and settlement_kind = 'historical_repair'
    and source_card_id is null;

  select count(*) into v_old_paid
  from public.card_installments
  where id in (
    'd3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'd3000000-0000-4000-8000-000000000003'
  ) and status = 'paid' and current_settlement_id is not null;

  select count(*) into v_current_paid
  from public.card_installments
  where id in (
    'd3000000-0000-4000-8000-000000000004',
    'd3000000-0000-4000-8000-000000000005',
    'd3000000-0000-4000-8000-000000000006'
  ) and status = 'paid' and current_settlement_id is not null;

  if v_debt <> 63446.30 or v_current <> 0 or v_balance <> 4831.47 then
    raise exception 'FAIL debt/current/balance 63446.30/0/4831.47 bekleniyordu, %/%/%', v_debt, v_current, v_balance;
  end if;
  if v_repair_count <> 1 or v_repair_amount <> 20115 then
    raise exception 'FAIL tarihsel repair settlement 20115 bekleniyordu, count=% amount=%', v_repair_count, v_repair_amount;
  end if;
  if v_old_paid <> 3 or v_current_paid <> 3 then
    raise exception 'FAIL eski/güncel allocation 3/3 bekleniyordu, %/%', v_old_paid, v_current_paid;
  end if;
end $$;

-- Belirsiz farkta tarihsel adaylar aggregate fazlayı tam kapatmıyorsa ödeme reddedilir
-- ve kaynak hesap/marker transaction alt bloğuyla birlikte değişmeden kalır.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  begin
    perform public.pay_card_debt(
      'c3000000-0000-4000-8000-000000000003',
      'c3000000-0000-4000-8000-000000000002',
      50
    );
    raise exception 'FAIL belirsiz hareket dağılımı reddedilmeliydi.';
  exception
    when others then
      if sqlerrm not like 'Güncel borcun hareket dağılımı uyuşmuyor.%' then
        raise;
      end if;
  end;
end $$;

reset role;

do $$
declare
  v_count integer;
  v_debt numeric;
begin
  select count(*) into v_count
  from public.card_current_settlements
  where card_id = 'c3000000-0000-4000-8000-000000000003';
  select debt_amount into v_debt
  from public.cards where id = 'c3000000-0000-4000-8000-000000000003';

  if v_count <> 0 or v_debt <> 100 then
    raise exception 'FAIL belirsiz onarım mutation bırakmamalı, settlement/debt %/%', v_count, v_debt;
  end if;

  raise notice 'Legacy current-payment allocation regresyonu OK.';
end $$;

rollback;
