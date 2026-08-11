-- Karma birikim hedefinin sayaçları bileşenlerden mi türetiliyor?
--
-- Faz D2 öncesi upsert_savings_goal client'ın gönderdiği target/current'ı
-- sorgusuz yazıyordu; ana satır bileşenlerden sessizce ayrışabiliyordu.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_goal uuid;
  v_row public.savings_goals%rowtype;
begin
  -- 1) Client kasıtlı olarak yanlış sayaç gönderiyor (99 / 77). Sunucu kendi
  --    hesabını yapmalı: 3 bileşen, 2'si hedefine ulaşmış.
  v_goal := public.upsert_savings_goal(
    null, 'Karma hedef', 'composite', 99, 77, null, false, null, 'active', null, true,
    '[{"label":"Altın","value_type":"gram_altin","target_amount":10,"current_amount":10,"sort_order":0},
      {"label":"Nakit","value_type":"TRY","target_amount":5000,"current_amount":1200,"sort_order":1},
      {"label":"Çeyrek","value_type":"ceyrek_altin","target_amount":4,"current_amount":4,"sort_order":2}]'::jsonb
  );

  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.target_amount <> 3 then
    raise exception 'BAŞARISIZ: bileşen sayısı 3 değil (%). Client değeri sızmış olabilir.', v_row.target_amount;
  end if;
  if v_row.current_amount <> 2 then
    raise exception 'BAŞARISIZ: hedefine ulaşan bileşen 2 değil (%).', v_row.current_amount;
  end if;

  -- 2) Bir bileşen daha hedefine ulaşınca sayaç kendiliğinden artmalı.
  perform public.upsert_savings_goal(
    v_goal, 'Karma hedef', 'composite', 0, 0, null, false, null, 'active', null, true,
    '[{"label":"Altın","value_type":"gram_altin","target_amount":10,"current_amount":10,"sort_order":0},
      {"label":"Nakit","value_type":"TRY","target_amount":5000,"current_amount":5000,"sort_order":1},
      {"label":"Çeyrek","value_type":"ceyrek_altin","target_amount":4,"current_amount":4,"sort_order":2}]'::jsonb
  );

  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.current_amount <> 3 then
    raise exception 'BAŞARISIZ: güncellemede ulaşan bileşen 3 değil (%).', v_row.current_amount;
  end if;

  -- 3) exceedsTL'in 1 kuruşluk grace'i: 1 kuruş eksik kalan bileşen ULAŞMIŞ sayılır
  --    (TS ikizi savingsGoalTargetReached ile aynı davranış), 2 kuruş eksik sayılmaz.
  perform public.upsert_savings_goal(
    v_goal, 'Karma hedef', 'composite', 0, 0, null, false, null, 'active', null, true,
    '[{"label":"Bir kuruş eksik","value_type":"TRY","target_amount":1000.00,"current_amount":999.99,"sort_order":0},
      {"label":"İki kuruş eksik","value_type":"TRY","target_amount":1000.00,"current_amount":999.98,"sort_order":1}]'::jsonb
  );

  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.target_amount <> 2 or v_row.current_amount <> 1 then
    raise exception 'BAŞARISIZ: kuruş toleransı beklenen 2/1 değil (%/%).', v_row.target_amount, v_row.current_amount;
  end if;

  -- 4) Basit (composite olmayan) hedefte davranış DEĞİŞMEMELİ: orada
  --    current/target gerçek kullanıcı girdisidir, türetilemez.
  v_goal := public.upsert_savings_goal(
    null, 'TL hedef', 'TRY', 25000, 8000, null, false, null, 'active', null, false, '[]'::jsonb
  );
  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.target_amount <> 25000 or v_row.current_amount <> 8000 then
    raise exception 'BAŞARISIZ: basit hedefin tutarları değişti (%/%).', v_row.target_amount, v_row.current_amount;
  end if;

  raise notice 'OK: karma hedef sayaçları bileşenlerden türetiliyor.';
end $$;

rollback;
