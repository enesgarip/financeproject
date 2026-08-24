-- Hedefe bağlı kasa kovası: ayırma birikimli, ay damgalı ve tek hedefe kilitli.
--
-- Riskler:
--  1) Ayırma client'ta oku-değiştir-yaz yapılsaydı iki sekme birbirini ezerdi;
--     artırım tek ifadede sunucuda olmalı.
--  2) "Bu ay ayrıldı mı?" bilgisi kaybolursa kart her ay tekrar ayırmayı önerir.
--  3) İki kova aynı hedefe bağlanırsa "kasada ayrılan" iki farklı sayı olur.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_goal uuid;
  v_bucket uuid;
  v_other uuid;
  v_reserved numeric;
  v_month date;
begin
  v_goal := public.upsert_savings_goal(
    null, 'Ev peşinatı', 'TRY', 600000, 0, null, false, '2026-12-31', 'active', null, false, '[]'::jsonb, '[]'::jsonb
  );

  insert into public.kasa_buckets (user_id, name, reserved_amount, goal_id)
  values (v_user, 'Ev peşinatı', 10000, v_goal)
  returning id into v_bucket;

  -- 1) Ayırma birikimlidir ve ayın damgasını basar.
  v_reserved := public.contribute_to_goal_bucket(v_bucket, 25000);
  if v_reserved <> 35000 then
    raise exception 'BAŞARISIZ: ayırma sonrası rezerv 35000 değil (%).', v_reserved;
  end if;

  select last_contribution_month into v_month from public.kasa_buckets where id = v_bucket;
  if v_month is distinct from date_trunc('month', current_date)::date then
    raise exception 'BAŞARISIZ: ay damgası basılmadı (%).', v_month;
  end if;

  -- 2) İkinci ayırma da eklenir (kullanıcı bilerek tekrar ayırabilir).
  v_reserved := public.contribute_to_goal_bucket(v_bucket, 5000);
  if v_reserved <> 40000 then
    raise exception 'BAŞARISIZ: ikinci ayırma birikmedi (%).', v_reserved;
  end if;

  -- 3) Sıfır/negatif tutar reddedilir.
  begin
    perform public.contribute_to_goal_bucket(v_bucket, 0);
    raise exception 'BAŞARISIZ: 0 tutarlı ayırma kabul edildi.';
  exception
    when raise_exception then
      if sqlerrm like 'BAŞARISIZ%' then raise; end if;
  end;

  -- 4) Bir hedefe ikinci kova bağlanamaz.
  insert into public.kasa_buckets (user_id, name, reserved_amount)
  values (v_user, 'İkinci kova', 0)
  returning id into v_other;

  begin
    update public.kasa_buckets set goal_id = v_goal where id = v_other;
    raise exception 'BAŞARISIZ: aynı hedefe ikinci kova bağlandı.';
  exception
    when unique_violation then null;
  end;

  -- 5) Hedef silinince kovadaki PARA kalır, yalnız bağ kopar.
  delete from public.savings_goals where id = v_goal;

  select reserved_amount, goal_id into v_reserved, v_goal from public.kasa_buckets where id = v_bucket;
  if v_reserved <> 40000 then
    raise exception 'BAŞARISIZ: hedef silinince kovadaki para değişti (%).', v_reserved;
  end if;
  if v_goal is not null then
    raise exception 'BAŞARISIZ: hedef silindi ama bağ koptu sayılmadı.';
  end if;

  raise notice 'OK: kova ayırması birikimli/ay damgalı, hedef başına tek kova, hedef silinince para korunuyor.';
end $$;

rollback;
