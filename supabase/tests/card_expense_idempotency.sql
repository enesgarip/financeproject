-- DH-02 regresyonu: kaynak olay kimliği retry'ı tekilleştirir; kaba işlem
-- benzerliği ise gerçek arka arkaya işlemleri birleştirmez.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_installment_card uuid;
  v_carryover_card uuid;
  v_payment_card uuid;
  v_payment uuid;
  v_count integer;
  v_history_count integer;
  v_debt numeric;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_user, 'Test', 'Idempotency pesin', 'kredi_karti', 50000, 25, 10)
  returning id into v_card;

  -- Aynı mantıksal istek iki kez: yalnız bir finansal etki.
  perform public.add_card_expense(v_card, 203, 'BURULAS', '2026-07-01', 1, 'Ulaşım', 'posted', null, 'manual', 'request-1');
  perform public.add_card_expense(v_card, 203, 'BURULAS', '2026-07-01', 1, 'Ulaşım', 'posted', null, 'manual', 'request-1');

  select count(*), max(amount) into v_count, v_debt
  from public.card_expenses where card_id = v_card;
  if v_count <> 1 then raise exception 'FAIL retry: 1 harcama bekleniyordu, %', v_count; end if;

  select debt_amount into v_debt from public.cards where id = v_card;
  if v_debt <> 203 then raise exception 'FAIL retry borc: 203 bekleniyordu, %', v_debt; end if;

  select count(*) into v_history_count
  from public.transaction_history where source_table = 'card_expenses' and source_id in (
    select id from public.card_expenses where card_id = v_card
  );
  if v_history_count <> 1 then raise exception 'FAIL retry history: 1 bekleniyordu, %', v_history_count; end if;

  -- Aynı alanlar, farklı olay kimlikleri: kullanıcının gerçek arka arkaya işlemleri.
  perform public.add_card_expense(v_card, 203, 'BURULAS', '2026-07-01', 1, 'Ulaşım', 'posted', null, 'manual', 'request-2');
  perform public.add_card_expense(v_card, 203, 'BURULAS', '2026-07-01', 1, 'Ulaşım', 'posted', null, 'manual', 'request-3');
  select count(*) into v_count from public.card_expenses where card_id = v_card;
  select debt_amount into v_debt from public.cards where id = v_card;
  if v_count <> 3 or v_debt <> 609 then
    raise exception 'FAIL gercek cift islem: count=3/debt=609 bekleniyordu, %/%', v_count, v_debt;
  end if;

  -- Aynı kimlik farklı kaynak namespace'inde bağımsızdır.
  perform public.add_card_expense(v_card, 50, 'SMS', '2026-07-01', 1, 'Diğer', 'provision', null, 'sms', 'request-1');
  select count(*) into v_count from public.card_expenses where card_id = v_card;
  if v_count <> 4 then raise exception 'FAIL source namespace: 4 bekleniyordu, %', v_count; end if;

  -- Taksitli retry taksit planını da yalnız bir kez üretir.
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_user, 'Test', 'Idempotency taksit', 'kredi_karti', 50000, 25, 10)
  returning id into v_installment_card;
  perform public.add_card_expense(v_installment_card, 300, 'Taksit', current_date, 3, 'Diğer', 'posted', null, 'manual', 'installment-1');
  perform public.add_card_expense(v_installment_card, 300, 'Taksit', current_date, 3, 'Diğer', 'posted', null, 'manual', 'installment-1');
  select count(*) into v_count from public.card_installments where card_id = v_installment_card;
  select debt_amount into v_debt from public.cards where id = v_installment_card;
  if v_count <> 3 or v_debt <> 300 then
    raise exception 'FAIL taksit retry: installments=3/debt=300 bekleniyordu, %/%', v_count, v_debt;
  end if;

  -- Plan ortası taksit devri wrapper'ı yalnız cari+gelecek açık taksitleri tek kez kurar.
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_user, 'Test', 'Idempotency devir', 'kredi_karti', 50000, 25, 10)
  returning id into v_carryover_card;
  perform public.record_card_installment_carryover(v_carryover_card, 'Devir', 100, 3, 1, current_date, 'Diğer', 'carryover-1');
  perform public.record_card_installment_carryover(v_carryover_card, 'Devir', 100, 3, 1, current_date, 'Diğer', 'carryover-1');
  select count(*) into v_count from public.card_installments where card_id = v_carryover_card;
  select debt_amount into v_debt from public.cards where id = v_carryover_card;
  if v_count <> 2 or v_debt <> 200 then
    raise exception 'FAIL carryover retry: installments=2/debt=200 bekleniyordu, %/%', v_count, v_debt;
  end if;

  -- Importta planlı ödemeye bağlanan kart harcaması ödeme durumunu ve borcu
  -- ikinci kez değiştirmez.
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_user, 'Test', 'Idempotency odeme', 'kredi_karti', 50000, 25, 10)
  returning id into v_payment_card;
  insert into public.payments (user_id, title, amount, due_date, category, status, auto_source_card_id)
  values (v_user, 'Internet', 250, current_date, 'Fatura', 'bekliyor', v_payment_card)
  returning id into v_payment;
  perform public.pay_payment_from_card_import(v_payment, v_payment_card, 250, current_date, 'payment-row-1', 'movement_import');
  perform public.pay_payment_from_card_import(v_payment, v_payment_card, 250, current_date, 'payment-row-1', 'movement_import');
  select count(*) into v_count from public.card_expenses where card_id = v_payment_card;
  select debt_amount into v_debt from public.cards where id = v_payment_card;
  if v_count <> 1 or v_debt <> 250 then
    raise exception 'FAIL payment import retry: expenses=1/debt=250 bekleniyordu, %/%', v_count, v_debt;
  end if;


  -- BM-6: iptal edilen kayit kimligi rezerve ETMEZ. Ayni kimlikle yeniden
  -- import taze kayit olusturur (iptali geri almanin kanonik yolu); borc geri gelir.
  -- Bu noktada kartta: manual request-1/2/3 (3x203) + sms provizyon 50 = 659.
  perform public.cancel_card_expense((
    select id from public.card_expenses
    where card_id = v_card and source = 'manual' and source_event_id = 'request-1'
  ));
  select debt_amount into v_debt from public.cards where id = v_card;
  if v_debt <> 456 then raise exception 'FAIL revival oncesi iptal: borc 456 bekleniyordu, %', v_debt; end if;

  perform public.add_card_expense(v_card, 203, 'BURULAS', '2026-07-01', 1, 'Ulasim', 'posted', null, 'manual', 'request-1');
  select count(*) into v_count from public.card_expenses
  where card_id = v_card and source = 'manual' and source_event_id = 'request-1' and status <> 'cancelled';
  select debt_amount into v_debt from public.cards where id = v_card;
  if v_count <> 1 or v_debt <> 659 then
    raise exception 'FAIL revival: aktif=1/borc=659 bekleniyordu, %/%', v_count, v_debt;
  end if;

  raise notice 'Kart harcama idempotency regresyonu OK.';
end $$;

rollback;
