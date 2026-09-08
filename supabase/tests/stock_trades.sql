-- Hisse işlem defteri: trade RPC aynı transaction'da satır yazar, açılış
-- backfill'i mevcut pozisyondan gelir, elle satır nakit/varlığa dokunmaz, RLS.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_account uuid;
  v_stock uuid;
  v_count int;
  v_kind text;
  v_qty numeric;
  v_price numeric;
  v_balance numeric;
  v_amount numeric;
  v_failed boolean;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, current_balance)
  values (v_user, 'Test', 'Borsa hesabı', 'banka_karti', 0, 100000) returning id into v_account;

  insert into public.assets (user_id, name, category, amount, unit, estimated_value_try, auto_valued, unit_cost, symbol)
  values (v_user, 'ASELS', 'Hisse', 10, 'TRY', 1000, false, 100, 'ASELS') returning id into v_stock;

  -- 1) Alış: defterde buy satırı, birim fiyat = nakit / adet, kaynak trade_rpc.
  perform public.trade_asset_with_account(v_stock, v_account, 'buy', 2200, 20, 'test alım');
  select count(*), min(kind), min(quantity), min(unit_price) into v_count, v_kind, v_qty, v_price
  from public.stock_trades where user_id = v_user and symbol = 'ASELS' and source = 'trade_rpc';
  if v_count <> 1 or v_kind <> 'buy' or v_qty <> 20 or v_price <> 110 then
    raise exception 'BAŞARISIZ: alış defter satırı (% / % / % / %).', v_count, v_kind, v_qty, v_price;
  end if;

  -- 2) Satış: sell satırı; varlık ve nakit RPC'nin eski davranışıyla oynar.
  perform public.trade_asset_with_account(v_stock, v_account, 'sell', 1500, 10, null);
  select count(*) into v_count from public.stock_trades where user_id = v_user and symbol = 'ASELS' and kind = 'sell' and quantity = 10 and unit_price = 150;
  if v_count <> 1 then
    raise exception 'BAŞARISIZ: satış defter satırı yok.';
  end if;
  select amount into v_amount from public.assets where id = v_stock;
  select current_balance into v_balance from public.cards where id = v_account;
  if v_amount <> 20 or v_balance <> 100000 - 2200 + 1500 then
    raise exception 'BAŞARISIZ: varlık/nakit eski davranış bozuldu (% / %).', v_amount, v_balance;
  end if;

  -- 3) Miktarsız (TRY nakit) işlem defter satırı üretmez.
  insert into public.assets (user_id, name, category, amount, unit, estimated_value_try, auto_valued)
  values (v_user, 'Nakit kasa', 'Nakit', 1, 'TRY', 500, false) returning id into v_stock;
  perform public.trade_asset_with_account(v_stock, v_account, 'sell', 100, null, null);
  select count(*) into v_count from public.stock_trades where user_id = v_user and asset_id = v_stock;
  if v_count <> 0 then
    raise exception 'BAŞARISIZ: miktarsız işlem defter satırı üretti.';
  end if;

  -- 4) Elle geçmiş işlem yalnız defteri besler: nakit ve varlık değişmez.
  select current_balance into v_balance from public.cards where id = v_account;
  insert into public.stock_trades (user_id, symbol, kind, trade_date, quantity, unit_price, fee, source)
  values (v_user, 'ASELS', 'buy', '2026-01-15', 5, 90, 2, 'manual');
  if (select current_balance from public.cards where id = v_account) <> v_balance then
    raise exception 'BAŞARISIZ: elle defter satırı nakite dokundu.';
  end if;

  -- 5) Kısıtlar: sembol biçimi, kind, miktar > 0, negatif komisyon.
  v_failed := false;
  begin
    insert into public.stock_trades (user_id, symbol, kind, trade_date, quantity, unit_price)
    values (v_user, 'thyao.is', 'buy', '2026-01-01', 1, 1);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'BAŞARISIZ: sembol biçimi kabul edildi.'; end if;
  v_failed := false;
  begin
    insert into public.stock_trades (user_id, symbol, kind, trade_date, quantity, unit_price)
    values (v_user, 'THYAO', 'buy', '2026-01-01', 0, 1);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'BAŞARISIZ: sıfır miktar kabul edildi.'; end if;
  v_failed := false;
  begin
    insert into public.stock_trades (user_id, symbol, kind, trade_date, quantity, unit_price, fee)
    values (v_user, 'THYAO', 'buy', '2026-01-01', 1, 1, -1);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'BAŞARISIZ: negatif komisyon kabul edildi.'; end if;
end $$;

-- 6) Migration açılış backfill'i seed'deki THYAO satırından üretildi mi?
--    (seed onu siler ve gerçek işlemlerle değiştirir; bu test seed SONRASI
--    koştuğu için 'opening' yerine seed satırlarını doğrular.)
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.stock_trades
  where user_id = '11111111-1111-1111-1111-111111111111' and symbol = 'THYAO' and source = 'manual';
  if v_count <> 3 then
    raise exception 'BAŞARISIZ: seed THYAO defteri 3 satır beklenirdi (%).', v_count;
  end if;
end $$;

-- 7) Başka kullanıcı satırları göremez.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.stock_trades;
  if v_count <> 0 then
    raise exception 'BAŞARISIZ: RLS başka kullanıcının işlemini gösterdi (% satır).', v_count;
  end if;
  raise notice 'Hisse işlem defteri regresyonu OK.';
end $$;

rollback;
