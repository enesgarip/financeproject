-- Hedef takip kaynakları: bağ kurulunca biriken tutar SAKLANMAZ, düzenlemede
-- bağ KAYBOLMAZ.
--
-- İki regresyon riski var:
--  1) Bağlı satırın `current_amount`'ı elle girilen değeri tutarsa, ekrandaki
--     türetilmiş tutarın yanında ikinci (bayat) bir gerçek doğar.
--  2) upsert_savings_goal bileşenleri sil-yaz ederse, bileşene bağlı kaynak
--     cascade ile uçar — kullanıcı hedefi her düzenlediğinde bağı kaybeder.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_asset uuid;
  v_goal uuid;
  v_comp_gold uuid;
  v_comp_stock uuid;
  v_row public.savings_goals%rowtype;
  v_count int;
  v_current numeric;
begin
  insert into public.assets (user_id, name, category, amount, unit, estimated_value_try, auto_valued)
  values (v_user, 'THYAO test', 'Hisse', 100, 'adet', 300000, false)
  returning id into v_asset;

  -- 1) Kaynağa bağlı basit hedef: client 777 gönderse de saklanan 0 olmalı.
  v_goal := public.upsert_savings_goal(
    null, 'Borsa', 'TRY', 1000000, 777, null, false, null, 'active', null, false, '[]'::jsonb,
    '[{"component_index":null,"kind":"asset_category","asset_category":"Hisse","sort_order":0}]'::jsonb
  );

  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.current_amount <> 0 then
    raise exception 'BAŞARISIZ: bağlı hedefin biriken tutarı saklanmış (%).', v_row.current_amount;
  end if;

  select count(*) into v_count from public.savings_goal_sources where goal_id = v_goal;
  if v_count <> 1 then
    raise exception 'BAŞARISIZ: hedef kaynağı yazılmadı (% satır).', v_count;
  end if;

  -- 2) Karma hedef: bir bileşen bağlı, biri elle.
  v_goal := public.upsert_savings_goal(
    null, 'Evlilik', 'composite', 0, 0, null, false, null, 'active', null, true,
    '[{"label":"Hisse","value_type":"TRY","target_amount":300000,"current_amount":999,"sort_order":0},
      {"label":"Gram","value_type":"gram_altin","target_amount":50,"current_amount":10,"sort_order":1}]'::jsonb,
    format('[{"component_index":0,"kind":"asset","asset_id":"%s","sort_order":0}]', v_asset)::jsonb
  );

  select id, current_amount into v_comp_stock, v_current
  from public.savings_goal_components where goal_id = v_goal and label = 'Hisse';
  if v_current <> 0 then
    raise exception 'BAŞARISIZ: bağlı bileşenin biriken tutarı saklanmış (%).', v_current;
  end if;

  select id, current_amount into v_comp_gold, v_current
  from public.savings_goal_components where goal_id = v_goal and label = 'Gram';
  if v_current <> 10 then
    raise exception 'BAŞARISIZ: bağsız bileşenin elle girdisi bozulmuş (%).', v_current;
  end if;

  -- 3) Düzenleme: bileşen id ile geldiğinde SATIR KORUNUR, bağ yaşar.
  perform public.upsert_savings_goal(
    v_goal, 'Evlilik', 'composite', 0, 0, null, false, null, 'active', null, true,
    format('[{"id":"%s","label":"Hisse","value_type":"TRY","target_amount":400000,"current_amount":0,"sort_order":0},
             {"id":"%s","label":"Gram","value_type":"gram_altin","target_amount":50,"current_amount":20,"sort_order":1}]',
           v_comp_stock, v_comp_gold)::jsonb,
    format('[{"component_index":0,"kind":"asset","asset_id":"%s","sort_order":0}]', v_asset)::jsonb
  );

  if not exists (select 1 from public.savings_goal_components where id = v_comp_stock) then
    raise exception 'BAŞARISIZ: düzenlemede bileşen satırı yeniden yaratılmış (bağlar uçar).';
  end if;

  select count(*) into v_count
  from public.savings_goal_sources where goal_id = v_goal and component_id = v_comp_stock;
  if v_count <> 1 then
    raise exception 'BAŞARISIZ: düzenlemeden sonra bileşen bağı kayboldu (% satır).', v_count;
  end if;

  -- 4) Bileşen listeden çıkarılınca kaynağı da gider (sahipsiz bağ kalmaz).
  perform public.upsert_savings_goal(
    v_goal, 'Evlilik', 'composite', 0, 0, null, false, null, 'active', null, true,
    format('[{"id":"%s","label":"Gram","value_type":"gram_altin","target_amount":50,"current_amount":20,"sort_order":0}]', v_comp_gold)::jsonb,
    '[]'::jsonb
  );

  select count(*) into v_count from public.savings_goal_sources where goal_id = v_goal;
  if v_count <> 0 then
    raise exception 'BAŞARISIZ: silinen bileşenin kaynağı kaldı (% satır).', v_count;
  end if;

  -- 5) Aynı kaynak iki kez gönderilirse tek satır kalır (çift sayma olmasın).
  v_goal := public.upsert_savings_goal(
    null, 'Çift kaynak', 'TRY', 1000, 0, null, false, null, 'active', null, false, '[]'::jsonb,
    format('[{"component_index":null,"kind":"asset","asset_id":"%s","sort_order":0},
             {"component_index":null,"kind":"asset","asset_id":"%s","sort_order":1}]', v_asset, v_asset)::jsonb
  );

  select count(*) into v_count from public.savings_goal_sources where goal_id = v_goal;
  if v_count <> 1 then
    raise exception 'BAŞARISIZ: aynı kaynak tekilleşmedi (% satır).', v_count;
  end if;

  -- 6) kind ile referans uyuşmazlığı DB seviyesinde reddedilmeli.
  begin
    insert into public.savings_goal_sources (user_id, goal_id, kind, card_id)
    values (v_user, v_goal, 'asset', null);
    raise exception 'BAŞARISIZ: kind↔referans check kısıtı çalışmadı.';
  exception
    when check_violation then null;
  end;

  -- 7) Bağsız hedefin davranışı DEĞİŞMEMELİ.
  v_goal := public.upsert_savings_goal(
    null, 'Elle hedef', 'TRY', 25000, 8000, null, false, null, 'active', null, false, '[]'::jsonb, '[]'::jsonb
  );
  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.current_amount <> 8000 then
    raise exception 'BAŞARISIZ: bağsız hedefin elle girdisi bozuldu (%).', v_row.current_amount;
  end if;

  raise notice 'OK: takip kaynakları yazılıyor, düzenlemede yaşıyor, tutar saklanmıyor.';
end $$;

rollback;
