-- Manuel varlık değer olayları: RPC tek transaction (olay + akış satırı + değer),
-- düşüş kaydı (eski amount>=0 kısıtı düşüşü yutuyordu), trigger/RPC çift yazım
-- yok, auto-valued satır olay üretmez, RLS own-row.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bes uuid;
  v_stock uuid;
  v_count int;
  v_before bigint;
  v_after bigint;
  v_contrib bigint;
  v_value numeric;
  v_hist_amount numeric;
  v_hist_title text;
  v_failed boolean;
begin
  insert into public.assets (user_id, name, category, amount, unit, estimated_value_try, auto_valued)
  values (v_user, 'BES testi', 'BES', 1, 'TRY', 100000, false) returning id into v_bes;
  insert into public.assets (user_id, name, category, amount, unit, estimated_value_try, auto_valued, symbol)
  values (v_user, 'Hisse testi', 'Hisse', 10, 'TRY', 1000, true, 'TEST') returning id into v_stock;

  -- 1) RPC: değer + katkı → TEK olay (trigger bastırılır), getiri = Δ − katkı.
  perform public.update_asset_value(v_bes, 110000, 5000, '2026-07-01T09:00:00+03:00', 'Temmuz');

  select count(*) into v_count from public.asset_value_events where asset_id = v_bes;
  if v_count <> 1 then
    raise exception 'BAŞARISIZ: RPC sonrası % olay (1 beklenir — trigger çift yazdı mı?).', v_count;
  end if;
  select value_before_kurus, value_after_kurus, contribution_kurus into v_before, v_after, v_contrib
  from public.asset_value_events where asset_id = v_bes;
  if v_before <> 10000000 or v_after <> 11000000 or v_contrib <> 500000 then
    raise exception 'BAŞARISIZ: olay alanları yanlış (% → %, katkı %).', v_before, v_after, v_contrib;
  end if;
  select estimated_value_try into v_value from public.assets where id = v_bes;
  if v_value <> 110000 then
    raise exception 'BAŞARISIZ: varlık değeri güncellenmedi (%).', v_value;
  end if;
  select amount, title into v_hist_amount, v_hist_title
  from public.transaction_history where source_table = 'assets' and source_id = v_bes and type = 'asset';
  if v_hist_amount <> 10000 or v_hist_title not like '%guncellendi' then
    raise exception 'BAŞARISIZ: akış satırı yanlış (% / %).', v_hist_amount, v_hist_title;
  end if;

  -- 2) DÜŞÜŞ kaydedilebilir: 110000 → 104000, katkı 5000 → getiri −11000.
  perform public.update_asset_value(v_bes, 104000, 5000, '2026-08-01T09:00:00+03:00', null);
  select value_after_kurus into v_after
  from public.asset_value_events where asset_id = v_bes order by occurred_at desc limit 1;
  if v_after <> 10400000 then
    raise exception 'BAŞARISIZ: düşüş olayı yazılmadı (%).', v_after;
  end if;
  select amount, title into v_hist_amount, v_hist_title
  from public.transaction_history where source_table = 'assets' and source_id = v_bes and type = 'asset'
  order by occurred_at desc limit 1;
  if v_hist_amount <> 6000 or v_hist_title not like '%dustu' then
    raise exception 'BAŞARISIZ: düşüş akış satırı yanlış (% / %) — tutar pozitif, yön başlıkta olmalı.', v_hist_amount, v_hist_title;
  end if;

  -- 3) Genel düzenleme formu (doğrudan UPDATE) → trigger olay yazar, katkı 0.
  update public.assets set estimated_value_try = 120000 where id = v_bes;
  select count(*) into v_count from public.asset_value_events where asset_id = v_bes;
  if v_count <> 3 then
    raise exception 'BAŞARISIZ: doğrudan update sonrası % olay (3 beklenir).', v_count;
  end if;
  -- Aynı transaction içinde created_at eşit; olay kaynağıyla seçilir.
  select count(*), min(contribution_kurus), min(value_before_kurus) into v_count, v_contrib, v_before
  from public.asset_value_events where asset_id = v_bes and source = 'trigger';
  if v_count <> 1 or v_contrib <> 0 or v_before <> 10400000 then
    raise exception 'BAŞARISIZ: trigger olayı yanlış (% adet / katkı % / önce %).', v_count, v_contrib, v_before;
  end if;

  -- 4) Değer aynı, katkı 0 → reddedilir; değer aynı ama katkı var → kabul (getiri eksi).
  begin
    perform public.update_asset_value(v_bes, 120000, 0, now(), null);
    v_failed := false;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'BAŞARISIZ: değişmeyen değer kabul edildi.';
  end if;
  perform public.update_asset_value(v_bes, 120000, 2000, now(), null);
  select count(*) into v_count
  from public.asset_value_events where asset_id = v_bes and contribution_kurus = 200000 and value_before_kurus = value_after_kurus;
  if v_count <> 1 then
    raise exception 'BAŞARISIZ: sıfır Δ + katkı olayı yazılmadı.';
  end if;

  -- 5) Auto-valued satır (günlük senkron) olay üretmez; RPC de reddeder.
  update public.assets set estimated_value_try = 1200 where id = v_stock;
  select count(*) into v_count from public.asset_value_events where asset_id = v_stock;
  if v_count <> 0 then
    raise exception 'BAŞARISIZ: auto-valued senkron olay üretti (%).', v_count;
  end if;
  begin
    perform public.update_asset_value(v_stock, 1300, 0, now(), null);
    v_failed := false;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'BAŞARISIZ: auto-valued varlık elle güncellendi.';
  end if;

  -- 6) Negatif değer reddi.
  begin
    perform public.update_asset_value(v_bes, -1, 0, now(), null);
    v_failed := false;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'BAŞARISIZ: negatif değer kabul edildi.';
  end if;
end $$;

-- 7) Başka kullanıcı olayları göremez, RPC ile dokunamaz.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_count int;
  v_failed boolean;
  v_bes uuid;
begin
  select count(*) into v_count from public.asset_value_events;
  if v_count <> 0 then
    raise exception 'BAŞARISIZ: RLS başka kullanıcının olayını gösterdi (% satır).', v_count;
  end if;
  select id into v_bes from public.assets where name = 'BES testi' limit 1;
  -- RLS altında satır görünmez; id bilinse bile RPC "bulunamadı" demeli.
  begin
    perform public.update_asset_value(coalesce(v_bes, gen_random_uuid()), 1, 0, now(), null);
    v_failed := false;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'BAŞARISIZ: başka kullanıcının varlığı güncellendi.';
  end if;
end $$;

rollback;
