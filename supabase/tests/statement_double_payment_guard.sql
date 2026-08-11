-- K4 regresyon testi: ekstre kovasi pay_card_debt ile sifirlandiktan sonra
-- pay_card_statement ayni borcu bankadan IKINCI kez dusmemeli.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'e0000000-0000-4000-8000-000000000001';
  v_card uuid := 'e0000000-0000-4000-8000-000000000002';
  v_archive uuid := 'e0000000-0000-4000-8000-000000000003';
  v_bank_row public.cards%rowtype;
  v_card_row public.cards%rowtype;
  v_guard_fired boolean := false;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_bank, v_user, 'Test Bank', 'Vadesiz', 'banka_karti', 10000);

  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, statement_debt_amount)
  values (v_card, v_user, 'Test Bank', 'Cift Odeme Karti', 'kredi_karti', 50000, 5000, 5000);

  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status
  )
  values (
    v_archive, v_user, v_card,
    extract(year from current_date)::integer, extract(month from current_date)::integer, current_date,
    5000, 5000, 5000, 'open'
  );

  -- 1) Kullanici borcu "kart borcu ode" akisiyla oduyor: kova sifirlanir,
  -- arsiv ACIK kalir (bilinen model).
  perform public.pay_card_debt(v_card, v_bank, 5000, false);

  select * into v_bank_row from public.cards where id = v_bank;
  if v_bank_row.current_balance <> 5000 then
    raise exception 'ONKOSUL BOZUK: ilk odeme sonrasi banka bakiyesi 5000 degil (%).', v_bank_row.current_balance;
  end if;

  select * into v_card_row from public.cards where id = v_card;
  if round(greatest(0, v_card_row.statement_debt_amount), 2) > 0 then
    raise exception 'ONKOSUL BOZUK: ekstre kovasi sifirlanmadi (%).', v_card_row.statement_debt_amount;
  end if;

  -- 2) Ayni arsiv icin "ekstreyi ode" denemesi guard'a takilmali.
  begin
    perform public.pay_card_statement(v_archive, v_bank, false);
  exception
    when others then
      v_guard_fired := true;
      if position('ikinci kez' in sqlerrm) = 0 then
        raise exception 'BASARISIZ: guard beklenen mesajla durdurmadi (%).', sqlerrm;
      end if;
  end;

  if not v_guard_fired then
    raise exception 'BASARISIZ: pay_card_statement cift odemeyi engellemedi.';
  end if;

  -- 3) Banka bakiyesi ikinci kez dusmemis olmali.
  select * into v_bank_row from public.cards where id = v_bank;
  if v_bank_row.current_balance <> 5000 then
    raise exception 'BASARISIZ: banka bakiyesi ikinci kez dusuldu (%).', v_bank_row.current_balance;
  end if;

  raise notice 'GECTI: ekstre cift odeme guard''i calisiyor.';
end;
$$;

rollback;
