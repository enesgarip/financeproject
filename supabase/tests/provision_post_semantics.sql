-- K3 regresyon testi: post_card_provision gecmis tarihli cok taksitli
-- provizyonda (1) taksit vadesini ISLEM GUNUNDEN turetmeli, (2) vadesi gecmis
-- TUM taksitleri posted yapmali, (3) current_period_spending'i gecmis
-- taksitlerin toplami kadar artirmali. 20260811100000 bu uc davranisi da
-- kaybetmisti; 20260812090000 geri getirdi.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid := 'd0000000-0000-4000-8000-000000000001';
  v_expense uuid := 'd0000000-0000-4000-8000-000000000002';
  -- 3 ay once ayin 15'i: gun bileseni hicbir ayda kirpilmaz, uc vade de bugune
  -- kadar gecmis olur.
  v_spent date := (date_trunc('month', current_date) - interval '3 months')::date + 14;
  v_posted public.card_expenses%rowtype;
  v_card_row public.cards%rowtype;
  v_row record;
  v_expected date;
  v_count integer;
begin
  -- Provizyon borcu zaten artirmis senaryo (20260802130000 modeli):
  -- debt = provision = 3000, kova kirilimi clamp'e takilmasin.
  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, provision_amount)
  values (v_card, v_user, 'Test Bank', 'Semantik Kart', 'kredi_karti', 50000, 3000, 3000);

  insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, installment_count, status)
  values (v_expense, v_user, v_card, v_spent, 3000, 'Gecmis provizyon', 'Diğer', 3, 'provision');

  select * into v_posted from public.post_card_provision(v_expense);

  if v_posted.status <> 'posted' then
    raise exception 'BASARISIZ: kesinlesen satir posted degil (%).', v_posted.status;
  end if;

  -- 1) Taksit vadeleri isleme gununden turetilmeli (ay basi DEGIL).
  select count(*) into v_count from public.card_installments where card_expense_id = v_posted.id;
  if v_count <> 3 then
    raise exception 'BASARISIZ: 3 taksit beklenirken % bulundu.', v_count;
  end if;

  for v_row in
    select installment_no, due_month, status
    from public.card_installments
    where card_expense_id = v_posted.id
    order by installment_no
  loop
    v_expected := (v_spent + ((v_row.installment_no - 1) * interval '1 month'))::date;
    if v_row.due_month <> v_expected then
      raise exception 'BASARISIZ: %. taksit vadesi % beklenirken % (ay-basi regresyonu?).',
        v_row.installment_no, v_expected, v_row.due_month;
    end if;
    if v_row.due_month = date_trunc('month', v_row.due_month)::date then
      raise exception 'BASARISIZ: %. taksit vadesi ay basina normalize edilmis (%).',
        v_row.installment_no, v_row.due_month;
    end if;
    -- 2) Uc vade de gecmiste -> hepsi posted dogmali.
    if v_row.status <> 'posted' then
      raise exception 'BASARISIZ: vadesi gecmis %. taksit posted degil (%).', v_row.installment_no, v_row.status;
    end if;
  end loop;

  -- 3) current_period_spending gecmis taksitlerin TOPLAMI (3000) kadar artmali,
  -- yalniz ilk taksit (1000) kadar degil. Borc degismemeli, provizyon sifirlanmali.
  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.current_period_spending <> 3000 then
    raise exception 'BASARISIZ: current_period_spending 3000 beklenirken % (yalniz-ilk-taksit regresyonu?).',
      v_card_row.current_period_spending;
  end if;
  if v_card_row.provision_amount <> 0 then
    raise exception 'BASARISIZ: provizyon kovasi sifirlanmadi (%).', v_card_row.provision_amount;
  end if;
  if v_card_row.debt_amount <> 3000 then
    raise exception 'BASARISIZ: borc degismemeliydi (3000 beklenirken %).', v_card_row.debt_amount;
  end if;

  raise notice 'GECTI: post_card_provision tarih/durum/kova semantigi dogru.';
end;
$$;

rollback;
