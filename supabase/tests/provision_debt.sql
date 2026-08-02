-- Regresyon: provizyon toplam borcu artirir (INC-01, migration 20260802130000).
-- npm run db:test:provision ile calisir (docker exec psql). Hata = raise exception => kirmizi.
-- Invariant'lar iis-kurali belgesinden (docs/CARD_DEBT_TRANSITIONS.md) turetildi.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  c1 uuid; c2 uuid; c3 uuid;
  e1 uuid;
  v_debt numeric; v_curr numeric; v_prov numeric;
begin
  -- 1) Bos kartta provizyon => debt=amount, provision=amount (KAYBOLMAZ)
  insert into public.cards (user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day)
  values ('11111111-1111-1111-1111-111111111111','T','PROV-TEST-1','kredi_karti',50000,25,10) returning id into c1;
  e1 := (public.add_card_expense(c1,200,'p','2026-08-01',1,'Market','provision')).id;
  select debt_amount,current_period_spending,provision_amount into v_debt,v_curr,v_prov from public.cards where id=c1;
  if v_debt <> 200 or v_curr <> 0 or v_prov <> 200 then
    raise exception 'FAIL create: beklenen debt=200/curr=0/prov=200, gelen %/%/%', v_debt,v_curr,v_prov;
  end if;

  -- 2) Provizyon post => debt SABIT, provision->current
  perform public.post_card_provision(e1, null);
  select debt_amount,current_period_spending,provision_amount into v_debt,v_curr,v_prov from public.cards where id=c1;
  if v_debt <> 200 or v_curr <> 200 or v_prov <> 0 then
    raise exception 'FAIL post: beklenen debt=200/curr=200/prov=0, gelen %/%/%', v_debt,v_curr,v_prov;
  end if;

  -- 3) Provizyon cancel => debt-=amount, provision-=amount
  insert into public.cards (user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day)
  values ('11111111-1111-1111-1111-111111111111','T','PROV-TEST-2','kredi_karti',50000,25,10) returning id into c2;
  perform public.add_card_expense(c2,150,'p','2026-08-01',1,'Market','provision');
  perform public.cancel_card_provision((select id from public.card_expenses where card_id=c2 limit 1));
  select debt_amount,provision_amount into v_debt,v_prov from public.cards where id=c2;
  if v_debt <> 0 or v_prov <> 0 then
    raise exception 'FAIL cancel: beklenen debt=0/prov=0, gelen %/%', v_debt,v_prov;
  end if;

  -- 4) Normal kart: posted 300 + provizyon 200 => debt=500, current YENMEZ (300), split<=debt
  insert into public.cards (user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day)
  values ('11111111-1111-1111-1111-111111111111','T','PROV-TEST-3','kredi_karti',50000,25,10) returning id into c3;
  perform public.add_card_expense(c3,300,'posted','2026-08-01',1,'Market','posted');
  perform public.add_card_expense(c3,200,'prov','2026-08-01',1,'Market','provision');
  select debt_amount,current_period_spending,provision_amount into v_debt,v_curr,v_prov from public.cards where id=c3;
  if v_debt <> 500 or v_curr <> 300 or v_prov <> 200 then
    raise exception 'FAIL normal: beklenen debt=500/curr=300/prov=200, gelen %/%/%', v_debt,v_curr,v_prov;
  end if;
  if (select statement_debt_amount+current_period_spending+provision_amount > debt_amount from public.cards where id=c3) then
    raise exception 'FAIL invariant: split > debt';
  end if;

  raise notice 'Provizyon-borc regresyonu OK: create/post/cancel/normal hepsi gecti.';
end $$;

rollback;
