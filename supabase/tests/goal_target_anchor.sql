-- Hedef tutarı çıpası: çıpalı hedefte tutar SAKLANMAZ, alan kombinasyonu tutarlı.
--
-- Riskler:
--  1) Çıpalı hedefte target_amount saklanırsa ekrandaki canlı tutarın yanında
--     ikinci (bayat) bir gerçek doğar.
--  2) Çıpa alanları birbirine karışırsa (gold + months) hangi hesabın
--     geçerli olduğu belirsizleşir.
--  3) Çıpa yalnız basit TL hedefte anlamlı; karma/altın hedefte sessizce
--     yanlış bir tutar üretmemeli.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_goal uuid;
  v_row public.savings_goals%rowtype;
begin
  -- 1) Altın çıpası: birim saklanır, tutar 0'a çekilir.
  v_goal := public.upsert_savings_goal(
    null, 'Borsa', 'TRY', 1000000, 0, null, false, null, 'active', null, false, '[]'::jsonb, '[]'::jsonb,
    'gold', 200, null
  );

  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.target_amount <> 0 then
    raise exception 'BAŞARISIZ: çıpalı hedefte tutar saklanmış (%).', v_row.target_amount;
  end if;
  if v_row.target_anchor <> 'gold' or v_row.target_anchor_units <> 200 or v_row.target_anchor_months is not null then
    raise exception 'BAŞARISIZ: çıpa alanları yanlış (% / % / %).', v_row.target_anchor, v_row.target_anchor_units, v_row.target_anchor_months;
  end if;

  -- 2) Gider katına geçiş: birim temizlenir, ay dolar.
  perform public.upsert_savings_goal(
    v_goal, 'Acil fon', 'TRY', 0, 0, null, false, null, 'active', null, false, '[]'::jsonb, '[]'::jsonb,
    'expense_months', null, 6
  );

  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.target_anchor_units is not null or v_row.target_anchor_months <> 6 then
    raise exception 'BAŞARISIZ: çıpa geçişinde eski alan temizlenmedi.';
  end if;

  -- 3) Manuel'e dönüşte tutar yeniden saklanır.
  perform public.upsert_savings_goal(
    v_goal, 'Acil fon', 'TRY', 250000, 0, null, false, null, 'active', null, false, '[]'::jsonb, '[]'::jsonb,
    'manual', null, null
  );

  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.target_amount <> 250000 or v_row.target_anchor <> 'manual'
    or v_row.target_anchor_units is not null or v_row.target_anchor_months is not null then
    raise exception 'BAŞARISIZ: manuel dönüşte alanlar temizlenmedi (% / %).', v_row.target_amount, v_row.target_anchor;
  end if;

  -- 4) Altın hedefinde çıpa sessizce uygulanmaz, manual'e düşer.
  v_goal := public.upsert_savings_goal(
    null, 'Gram hedefi', 'gram_altin', 100, 0, null, false, null, 'active', null, false, '[]'::jsonb, '[]'::jsonb,
    'gold', 50, null
  );

  select * into v_row from public.savings_goals where id = v_goal;
  if v_row.target_anchor <> 'manual' or v_row.target_amount <> 100 then
    raise exception 'BAŞARISIZ: altın hedefinde çıpa uygulanmış (% / %).', v_row.target_anchor, v_row.target_amount;
  end if;

  -- 5) Eksik/çelişkili çıpa alanı reddedilir.
  begin
    perform public.upsert_savings_goal(
      null, 'Bozuk', 'TRY', 1000, 0, null, false, null, 'active', null, false, '[]'::jsonb, '[]'::jsonb,
      'gold', null, null
    );
    raise exception 'BAŞARISIZ: birimsiz altın çıpası kabul edildi.';
  exception
    when raise_exception then
      if sqlerrm like 'BAŞARISIZ%' then raise; end if;
  end;

  begin
    insert into public.savings_goals (user_id, name, value_type, target_amount, current_amount, target_anchor, target_anchor_units, target_anchor_months)
    values (v_user, 'Çelişkili', 'TRY', 0, 0, 'gold', 10, 6);
    raise exception 'BAŞARISIZ: gold + months birlikte kabul edildi.';
  exception
    when check_violation then null;
  end;

  raise notice 'OK: çıpalı hedefte tutar saklanmıyor, alanlar tutarlı, çıpa yalnız TL hedefte.';
end $$;

rollback;
