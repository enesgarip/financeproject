-- BM-7 C-1/C-2 regresyonu: varlık satışında değer düşümü miktara oransal;
-- kârda satış engellenmez, tam satış hayalet değer bırakmaz.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_account uuid;
  v_stock uuid;
  v_stock2 uuid;
  v_cash uuid;
  v_value numeric;
  v_amount numeric;
  v_balance numeric;
  v_failed boolean;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, current_balance)
  values (v_user, 'Test', 'Tahsilat', 'banka_karti', 0, 1000) returning id into v_account;

  -- ── C-1: Kârda kısmi hisse satışı — nakit bedel oransal değeri aşabilir.
  -- 10 adet, kayıtlı değer 1000 (birim 100). 4 adet 600'e satılır (kâr: oransal
  -- değer 400 ama tahsilat 600). Değer 10→6 adede oranla 600 kalmalı; borç değil.
  insert into public.assets (user_id, name, category, amount, unit, estimated_value_try, auto_valued, unit_cost)
  values (v_user, 'THYAO', 'Hisse', 10, 'adet', 1000, false, 100) returning id into v_stock;

  perform public.trade_asset_with_account(v_stock, v_account, 'sell', 600, 4, null);

  select amount, estimated_value_try into v_amount, v_value from public.assets where id = v_stock;
  if v_amount <> 6 then raise exception 'FAIL C1 miktar: 6 bekleniyordu, %', v_amount; end if;
  if v_value <> 600 then raise exception 'FAIL C1 oransal değer: 600 bekleniyordu, %', v_value; end if;

  select current_balance into v_balance from public.cards where id = v_account;
  if v_balance <> 1600 then raise exception 'FAIL C1 tahsilat: 1000+600=1600 bekleniyordu, %', v_balance; end if;

  -- ── C-2: Tam satış hayalet değer bırakmaz. Kalan 6 adet 300'e (zararına)
  -- satılır; miktar 0, değer de 0 olmalı (kayıtlı değer 600 > tahsilat 300 olsa da).
  perform public.trade_asset_with_account(v_stock, v_account, 'sell', 300, 6, null);
  select amount, estimated_value_try into v_amount, v_value from public.assets where id = v_stock;
  if v_amount <> 0 then raise exception 'FAIL C2 miktar: 0 bekleniyordu, %', v_amount; end if;
  if v_value <> 0 then raise exception 'FAIL C2 hayalet değer: 0 bekleniyordu, %', v_value; end if;

  -- ── Miktar taşıyan satışta üst sınır MİKTARDIR; fazla miktar reddedilir.
  insert into public.assets (user_id, name, category, amount, unit, estimated_value_try, auto_valued, unit_cost)
  values (v_user, 'ASELS', 'Hisse', 5, 'adet', 500, false, 100) returning id into v_stock2;
  v_failed := false;
  begin
    perform public.trade_asset_with_account(v_stock2, v_account, 'sell', 10000, 9, null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL miktar aşımı reddedilmeliydi'; end if;
  if (select amount from public.assets where id = v_stock2) <> 5 then
    raise exception 'FAIL reddedilen satış miktarı değiştirdi';
  end if;

  -- ── Miktarsız (yalnız-değerleme TRY) satışta üst sınır kayıtlı değerdir.
  insert into public.assets (user_id, name, category, amount, unit, estimated_value_try, auto_valued)
  values (v_user, 'Yatırım Fonu Değerleme', 'Diğer', 0, 'TRY', 500, false) returning id into v_cash;
  v_failed := false;
  begin
    perform public.trade_asset_with_account(v_cash, v_account, 'sell', 600, null, null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL miktarsız satış tutar aşımı reddedilmeliydi'; end if;

  -- Miktarsız satış tutar kadar düşer (kısmi).
  perform public.trade_asset_with_account(v_cash, v_account, 'sell', 200, null, null);
  if (select estimated_value_try from public.assets where id = v_cash) <> 300 then
    raise exception 'FAIL miktarsız kısmi satış: 500-200=300 bekleniyordu';
  end if;

  raise notice 'Varlık al-sat oransal değer regresyonu OK (kârda satış + hayalet değer + miktar/tutar sınırları).';
end $$;

rollback;
