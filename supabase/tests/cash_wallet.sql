-- Nakit cüzdanı mevcut banka-hesabı RPC ve ledger invariant'larını paylaşır.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'ca500000-0000-4000-8000-000000000001';
  v_cash uuid := 'ca500000-0000-4000-8000-000000000002';
  v_payment uuid := 'ca500000-0000-4000-8000-000000000003';
  v_balance numeric;
  v_ledger bigint;
  v_failed boolean := false;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, account_kind, current_balance)
  values
    (v_bank, v_user, 'Test Bank', 'Ana hesap', 'banka_karti', 'bank', 1000),
    (v_cash, v_user, 'Nakit', 'Cüzdan', 'banka_karti', 'cash', 200);

  perform public.transfer_between_accounts(v_bank, v_cash, 300, 'ATM nakit çekimi');

  select current_balance into v_balance from public.cards where id = v_cash;
  if v_balance <> 500 then
    raise exception 'BASARISIZ: transfer sonrası nakit 500 beklenirken %.', v_balance;
  end if;

  insert into public.payments (id, user_id, title, category, amount, due_date, status)
  values (v_payment, v_user, 'Nakit ödeme', 'Diğer', 125, current_date, 'bekliyor');

  perform public.pay_payment(v_payment, v_cash);

  select current_balance into v_balance from public.cards where id = v_cash;
  if v_balance <> 375 then
    raise exception 'BASARISIZ: ödeme sonrası nakit 375 beklenirken %.', v_balance;
  end if;

  select coalesce(sum(amount_kurus), 0) into v_ledger
  from public.account_ledger where card_id = v_cash;
  if v_ledger <> 37500 then
    raise exception 'BASARISIZ: nakit ledger 37500 kuruş beklenirken %.', v_ledger;
  end if;

  begin
    insert into public.cards (user_id, bank_name, card_name, card_type, account_kind)
    values (v_user, 'Test Bank', 'Geçersiz', 'kredi_karti', 'cash');
  exception when check_violation then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'BASARISIZ: kredi kartı cash account_kind kabul edilmemeliydi.';
  end if;

  raise notice 'GECTI: nakit cüzdanı transfer + ödeme + ledger + kısıt.';
end;
$$;

rollback;
