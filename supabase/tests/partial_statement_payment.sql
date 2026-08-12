-- K7 tam kapsam: kismi/asgari ekstre odemesi (card_statement_payments).
-- Kalan = arsiv - odemeler; kova kalanlara projekte; tam odeme arsivi kapatir.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'a0000000-0000-4000-8000-0000000000b1';
  v_card uuid := 'a0000000-0000-4000-8000-0000000000c1';
  v_archive uuid := 'a0000000-0000-4000-8000-0000000000d1';
  v_bank_row public.cards%rowtype;
  v_card_row public.cards%rowtype;
  v_archive_row public.card_statement_archives%rowtype;
  v_payment_count integer;
  v_history_count integer;
  v_guard_fired boolean := false;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_bank, v_user, 'Test Bank', 'Vadesiz', 'banka_karti', 20000);

  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, statement_debt_amount)
  values (v_card, v_user, 'Test Bank', 'Kismi Kart', 'kredi_karti', 50000, 5000, 5000);

  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status
  )
  values (
    v_archive, v_user, v_card,
    extract(year from current_date)::integer, extract(month from current_date)::integer, current_date,
    5000, 5000, 5000, 'open'
  );

  -- 1) Kismi odeme 1000: arsiv ACIK kalir, kova/borc/bakiye 1000 duser.
  perform public.pay_card_statement(v_archive, v_bank, false, 1000);

  select * into v_archive_row from public.card_statement_archives where id = v_archive;
  if v_archive_row.status <> 'open' then
    raise exception 'BASARISIZ: kismi odeme arsivi kapatti (%).', v_archive_row.status;
  end if;
  if v_archive_row.statement_debt_amount <> 5000 then
    raise exception 'BASARISIZ: arsiv tutari degisti (%) — degismez olmaliydi.', v_archive_row.statement_debt_amount;
  end if;

  select * into v_bank_row from public.cards where id = v_bank;
  if v_bank_row.current_balance <> 19000 then
    raise exception 'BASARISIZ: banka bakiyesi 19000 degil (%).', v_bank_row.current_balance;
  end if;

  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.statement_debt_amount <> 4000 or v_card_row.debt_amount <> 4000 then
    raise exception 'BASARISIZ: kova/borc 4000 degil (%/%).', v_card_row.statement_debt_amount, v_card_row.debt_amount;
  end if;

  select count(*) into v_history_count
  from public.transaction_history
  where source_id = v_archive and title like '%kısmen ödendi%';
  if v_history_count <> 1 then
    raise exception 'BASARISIZ: kismi odeme history kaydi yok.';
  end if;

  -- 2) Kalanin ustunde odeme reddedilir (kalan 4000).
  begin
    perform public.pay_card_statement(v_archive, v_bank, false, 4500);
  exception
    when others then
      v_guard_fired := true;
      if position('kalan borcundan' in sqlerrm) = 0 then
        raise exception 'BASARISIZ: beklenmeyen hata: %', sqlerrm;
      end if;
  end;
  if not v_guard_fired then
    raise exception 'BASARISIZ: kalan ustu odeme kabul edildi.';
  end if;

  -- 3) Ikinci kismi odeme 1500 -> kalan 2500.
  perform public.pay_card_statement(v_archive, v_bank, false, 1500);
  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.statement_debt_amount <> 2500 then
    raise exception 'BASARISIZ: ikinci kismi sonrasi kova 2500 degil (%).', v_card_row.statement_debt_amount;
  end if;

  -- 4) Tam odeme (p_amount null) kalan 2500'u oder, arsivi kapatir.
  perform public.pay_card_statement(v_archive, v_bank, false, null);

  select * into v_archive_row from public.card_statement_archives where id = v_archive;
  if v_archive_row.status <> 'paid' or v_archive_row.paid_at is null then
    raise exception 'BASARISIZ: tam odeme arsivi kapatmadi (%).', v_archive_row.status;
  end if;

  select * into v_bank_row from public.cards where id = v_bank;
  if v_bank_row.current_balance <> 15000 then
    raise exception 'BASARISIZ: toplam 5000 dusmedi (bakiye %).', v_bank_row.current_balance;
  end if;

  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.debt_amount <> 0 or v_card_row.statement_debt_amount <> 0 then
    raise exception 'BASARISIZ: borc/kova sifirlanmadi (%/%).', v_card_row.debt_amount, v_card_row.statement_debt_amount;
  end if;

  select count(*) into v_payment_count from public.card_statement_payments where statement_archive_id = v_archive;
  if v_payment_count <> 3 then
    raise exception 'BASARISIZ: 3 odeme kaydi beklenirken %.', v_payment_count;
  end if;

  -- 5) Kapali arsive tekrar odeme reddedilir.
  v_guard_fired := false;
  begin
    perform public.pay_card_statement(v_archive, v_bank, false, 100);
  exception
    when others then v_guard_fired := true;
  end;
  if not v_guard_fired then
    raise exception 'BASARISIZ: kapali arsive odeme kabul edildi.';
  end if;

  -- 6) Append-only, kullanici rolu: UPDATE denemesi satiri DEGISTIRMEMELI.
  -- Iki mesru yol da kabul: yetki/policy reddi (exception) ya da RLS'in satiri
  -- hic gormemesi (0 satir). Invariant "satir degismez" oldugu icin testin
  -- assertion'i da bu — ortama gore degisen hata metnine bagli degil.
  begin
    update public.card_statement_payments set amount = 1 where statement_archive_id = v_archive;
  exception
    when others then null;
  end;

  if exists (select 1 from public.card_statement_payments where statement_archive_id = v_archive and amount = 1) then
    raise exception 'BASARISIZ: odeme kaydi authenticated rolunde guncellenebildi.';
  end if;

  raise notice 'GECTI: kismi ekstre odemesi — kalan/kova/kapanis dogru.';
end;
$$;

-- 7) Guard trigger'in KENDISI: RLS'i bypass eden rolde (auth.uid() null, reset
-- GUC'u yok) update/delete mutlaka exception atmali. Yukaridaki authenticated
-- denemesi RLS'e takilip trigger'a hic ulasmayabilir; guard bu blokla sinanir.
reset role;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'a0000000-0000-4000-8000-0000000000b9';
  v_card uuid := 'a0000000-0000-4000-8000-0000000000c9';
  v_archive uuid := 'a0000000-0000-4000-8000-0000000000d9';
  v_payment uuid := 'a0000000-0000-4000-8000-0000000000e9';
  v_guard_fired boolean;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_bank, v_user, 'Test Bank', 'Vadesiz9', 'banka_karti', 1000);
  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, statement_debt_amount)
  values (v_card, v_user, 'Test Bank', 'Guard Kart', 'kredi_karti', 50000, 500, 500);
  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status
  )
  values (v_archive, v_user, v_card, 2026, 6, '2026-06-25', 500, 500, 500, 'open');
  insert into public.card_statement_payments (id, user_id, card_id, statement_archive_id, amount)
  values (v_payment, v_user, v_card, v_archive, 100);

  v_guard_fired := false;
  begin
    update public.card_statement_payments set amount = 999 where id = v_payment;
  exception
    when others then
      v_guard_fired := true;
      if position('append-only' in sqlerrm) = 0 then
        raise exception 'BASARISIZ: guard beklenen mesajla durdurmadi (%).', sqlerrm;
      end if;
  end;
  if not v_guard_fired then
    raise exception 'BASARISIZ: guard trigger UPDATE''i engellemedi.';
  end if;

  v_guard_fired := false;
  begin
    delete from public.card_statement_payments where id = v_payment;
  exception
    when others then v_guard_fired := true;
  end;
  if not v_guard_fired then
    raise exception 'BASARISIZ: guard trigger DELETE''i engellemedi.';
  end if;

  raise notice 'GECTI: card_statement_payments append-only guard trigger''i calisiyor.';
end;
$$;

rollback;
