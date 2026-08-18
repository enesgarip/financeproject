-- Iki regresyonu birlikte kilitler:
--
-- 1) TAKVIM: veritabaninin gunu Istanbul olmali (20260819120000). UTC'ye
--    donerse Istanbul saatiyle 00:00-03:00 arasi yapilan islemde `current_date`
--    dunu gosterir ve o gun vadesi gelen taksit donem ici borca girmez.
-- 2) TAKSIT NIYETI (20260819110000): SMS provizyonu taksit bilgisi tasimadigi
--    icin tek cekim dogar; alisveris oncesi birakilan niyet onu etiketler.
--    Eslesme kart + tutar penceresi + satici ipucu + gecerlilik ile sinirli
--    olmali, ve para modeline DOKUNMAMALI.
begin;

-- Rol DEGISTIRILMEZ: private.apply_card_installment_intent kasitli olarak
-- authenticated'a kapali (SMS RPC'si icinden cagrilir). Yalniz JWT iddiasi
-- ayarlanir; post_card_provision auth.uid()'i oradan okur.
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- --- 1) Takvim ---------------------------------------------------------------
do $$
begin
  if current_date <> (now() at time zone 'Europe/Istanbul')::date then
    raise exception
      'BASARISIZ: current_date (%) Istanbul takvimi (%) ile ayni degil — veritabani saat dilimi UTC''ye mi dondu?',
      current_date, (now() at time zone 'Europe/Istanbul')::date;
  end if;

  if private.today_ist() <> current_date then
    raise exception 'BASARISIZ: private.today_ist() (%) current_date (%) ile ayrisiyor.',
      private.today_ist(), current_date;
  end if;
end
$$;

-- --- 2) Taksit niyeti --------------------------------------------------------
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid := 'e0000000-0000-4000-8000-000000000001';
  v_other_card uuid := 'e0000000-0000-4000-8000-000000000002';
  v_expense public.card_expenses%rowtype;
  v_card_row public.cards%rowtype;
  v_consumed_count integer;
  v_current_after numeric;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount)
  values
    (v_card, v_user, 'Test Bank', 'Niyet Kart', 'kredi_karti', 90000, 0),
    (v_other_card, v_user, 'Test Bank', 'Baska Kart', 'kredi_karti', 90000, 0);

  -- Eslesmemesi gereken uc niyet: suresi dolmus, tutar penceresi disi, baska kart.
  insert into public.card_installment_intents (user_id, card_id, installment_count, expires_at)
  values (v_user, v_card, 12, now() - interval '1 hour');
  insert into public.card_installment_intents (user_id, card_id, min_amount, max_amount, installment_count, expires_at)
  values (v_user, v_card, 50000, 60000, 9, now() + interval '2 days');
  insert into public.card_installment_intents (user_id, card_id, installment_count, expires_at)
  values (v_user, v_other_card, 4, now() + interval '2 days');

  -- Eslesmesi gereken: tr-TR buyuk-I tuzagi ("migros" ipucu ↔ "MIGROS ATASEHIR").
  insert into public.card_installment_intents (user_id, card_id, merchant_hint, min_amount, max_amount, installment_count, expires_at)
  values (v_user, v_card, 'migros', 3000, 15000, 3, now() + interval '2 days');

  insert into public.card_expenses (user_id, card_id, spent_at, amount, description, category, installment_count, status)
  values (v_user, v_card, current_date, 6000, 'MIGROS ATASEHIR', 'Market', 1, 'provision')
  returning * into v_expense;

  update public.cards set debt_amount = 6000, provision_amount = 6000 where id = v_card;

  select * into v_expense from private.apply_card_installment_intent(v_expense.id, v_user);

  if v_expense.installment_count <> 3 then
    raise exception 'BASARISIZ: niyet uygulanmadi (taksit sayisi %).', v_expense.installment_count;
  end if;

  if v_expense.installment_amount <> 2000 then
    raise exception 'BASARISIZ: taksit tutari 2000 beklenirken % .', v_expense.installment_amount;
  end if;

  -- Para modeli DEGISMEMELI: etiket yazildi, borc/kova ayni kaldi.
  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.debt_amount <> 6000 or v_card_row.provision_amount <> 6000 then
    raise exception 'BASARISIZ: niyet para modeline dokundu (borc %, provizyon %).',
      v_card_row.debt_amount, v_card_row.provision_amount;
  end if;

  -- Yalniz dogru niyet tuketilmeli; digerleri aktif kalmali.
  select count(*) into v_consumed_count from public.card_installment_intents
  where user_id = v_user and status = 'consumed';
  if v_consumed_count <> 1 then
    raise exception 'BASARISIZ: 1 niyet tuketilmeliydi, % tuketildi.', v_consumed_count;
  end if;

  -- Ikinci cagri: artik aktif eslesen niyet yok, etiket degismemeli.
  update public.card_expenses set installment_count = 1, installment_amount = 6000 where id = v_expense.id;
  select * into v_expense from private.apply_card_installment_intent(v_expense.id, v_user);
  if v_expense.installment_count <> 1 then
    raise exception 'BASARISIZ: tuketilmis/uyumsuz niyetler tekrar uygulandi (taksit %).',
      v_expense.installment_count;
  end if;

  -- Takvim + kesinlestirme birlikte: bugun vadeli ilk taksit donem ici borca girmeli.
  update public.card_expenses set installment_count = 3, installment_amount = 2000 where id = v_expense.id;
  perform public.post_card_provision(v_expense.id);

  select current_period_spending into v_current_after from public.cards where id = v_card;
  if v_current_after <> 2000 then
    raise exception
      'BASARISIZ: bugun vadeli ilk taksit donem ici borca girmedi (current_period_spending %). UTC/Istanbul gun kaymasi?',
      v_current_after;
  end if;
end
$$;

rollback;
