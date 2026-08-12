-- pay_card_debt B1 residual yolu (20260810140000; denetim 2026-08-12 §8/3).
-- Kova (current_period_spending=1000) ile allocation'siz posted satir toplami
-- (1200) uyusmuyor ve fark tarihsel aciklamaya SAHIP DEGIL (satirlar bu cevrim
-- icinde). Tam guncel odeme yine gecmeli: tum satirlar settlement'a baglanir,
-- kova-satir farki auditable residual olarak settlement notuna + bir correction
-- history kaydina yazilir, kova 0'a iner.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'f1000000-0000-4000-8000-000000000001';
  v_card uuid := 'f1000000-0000-4000-8000-000000000002';
  v_exp1 uuid := 'f1000000-0000-4000-8000-000000000003';
  v_exp2 uuid := 'f1000000-0000-4000-8000-000000000004';
  v_settlement public.card_current_settlements%rowtype;
  v_card_row public.cards%rowtype;
  v_bank_row public.cards%rowtype;
  v_count integer;
  v_correction_amount numeric;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_bank, v_user, 'Test Bank', 'Vadesiz', 'banka_karti', 5000);

  -- Kova-satir farki: debt=1200 (satir toplami), current=1000 (kova).
  -- Clamp guvenli: statement+provision+current = 1000 <= 1200.
  insert into public.cards (
    id, user_id, bank_name, card_name, card_type, credit_limit,
    debt_amount, statement_debt_amount, current_period_spending, provision_amount, statement_day
  )
  values (v_card, v_user, 'Test Bank', 'Residual Karti', 'kredi_karti', 50000, 1200, 0, 1000, 0, 15);

  -- Allocation'siz posted satirlar BU cevrim icinde (spent_at=bugun) ->
  -- historical_repair yolu devreye giremez, fark residual olarak kalir.
  insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, installment_count, status, posted_at)
  values
    (v_exp1, v_user, v_card, current_date, 700, 'Market', 'Market', 1, 'posted', now()),
    (v_exp2, v_user, v_card, current_date, 500, 'Yakit', 'Ulaşım', 1, 'posted', now());

  -- Tam guncel odeme: statement=0 + amount = current_period_spending.
  perform public.pay_card_debt(v_card, v_bank, 1000, false);

  -- 1) Tek 'payment' settlement olustu ve notunda residual kaydi var.
  select count(*) into v_count
  from public.card_current_settlements
  where card_id = v_card and user_id = v_user;
  if v_count <> 1 then
    raise exception 'BASARISIZ: 1 settlement beklenirken % (historical_repair yanlislikla mi calisti?).', v_count;
  end if;

  select * into v_settlement
  from public.card_current_settlements
  where card_id = v_card and user_id = v_user;
  if v_settlement.settlement_kind <> 'payment' then
    raise exception 'BASARISIZ: settlement kind payment beklenirken %.', v_settlement.settlement_kind;
  end if;
  if position('residual' in v_settlement.note) = 0 then
    raise exception 'BASARISIZ: settlement notunda residual kaydi yok (%).', v_settlement.note;
  end if;

  -- 2) Tum allocation'siz satirlar bu settlement'a baglandi.
  select count(*) into v_count
  from public.card_expenses
  where card_id = v_card and status = 'posted' and current_settlement_id is null;
  if v_count <> 0 then
    raise exception 'BASARISIZ: % satir hala allocation''siz.', v_count;
  end if;

  select count(*) into v_count
  from public.card_expenses
  where card_id = v_card and current_settlement_id = v_settlement.id;
  if v_count <> 2 then
    raise exception 'BASARISIZ: 2 satir settlement''a baglanmaliydi, % baglandi.', v_count;
  end if;

  -- 3) Correction history kaydi: kova-satir farki 200 TL (abs) olarak denetlenebilir.
  select count(*), max(amount) into v_count, v_correction_amount
  from public.transaction_history
  where source_table = 'card_current_settlements'
    and source_id = v_settlement.id
    and type = 'correction';
  if v_count <> 1 then
    raise exception 'BASARISIZ: 1 correction history kaydi beklenirken %.', v_count;
  end if;
  if v_correction_amount <> 200 then
    raise exception 'BASARISIZ: correction tutari 200 beklenirken %.', v_correction_amount;
  end if;

  -- 4) Kova 0'a indi; borc odeme kadar dustu; banka bakiyesi bir kez dusuldu.
  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.current_period_spending <> 0 then
    raise exception 'BASARISIZ: kova sifirlanmadi (%).', v_card_row.current_period_spending;
  end if;
  if v_card_row.debt_amount <> 200 then
    raise exception 'BASARISIZ: borc 1200-1000=200 beklenirken %.', v_card_row.debt_amount;
  end if;

  select * into v_bank_row from public.cards where id = v_bank;
  if v_bank_row.current_balance <> 4000 then
    raise exception 'BASARISIZ: banka bakiyesi 4000 beklenirken %.', v_bank_row.current_balance;
  end if;

  raise notice 'GECTI: pay_card_debt B1 residual yolu dogru (satirlar baglandi, fark denetlenebilir).';
end;
$$;

rollback;
