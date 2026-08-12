-- Faz F DB duzeltmeleri (migration 20260812120000):
--  1) update_card_expense banka karti yolunda bakiye kontrolu IADE SONRASI
--     degeri kullanir (yanlis red yok).
--  2) reset_card_import_data erken odeme / odenmis-ekstre on-kosullarinda
--     anlamli mesajla durur (jenerik trigger hatasi degil).
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1) Bakiye 0'a inmis banka hesabinda harcamayi KUCULTMEK reddedilmemeli.
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'f1000000-0000-4000-8000-000000000001';
  v_expense uuid := 'f1000000-0000-4000-8000-000000000002';
  v_card_row public.cards%rowtype;
  v_expense_row public.card_expenses%rowtype;
begin
  -- Hesap 100 TL ile aciliyor, 100 TL harcama bakiyeyi 0'a indiriyor.
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_bank, v_user, 'Test Bank', 'Vadesiz F', 'banka_karti', 100);

  insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, status, posted_at)
  values (v_expense, v_user, v_bank, current_date, 100, 'Market', 'Market', 'posted', now());

  update public.cards set current_balance = 0 where id = v_bank;

  -- Tutari 50 TL'ye DUSURMEK: iade sonrasi 100 TL var, kabul edilmeli.
  select * into v_expense_row
  from public.update_card_expense(v_expense, 50, 'Market', current_date, 1, 'Market', null);

  if v_expense_row.amount <> 50 then
    raise exception 'BASARISIZ: tutar 50 olmadi (%).', v_expense_row.amount;
  end if;

  select * into v_card_row from public.cards where id = v_bank;
  if v_card_row.current_balance <> 50 then
    raise exception 'BASARISIZ: bakiye 50 olmadi (%) — iade/dusum matematigi bozuk.', v_card_row.current_balance;
  end if;

  raise notice 'GECTI: update_card_expense banka yolunda yanlis red uretmiyor.';
end;
$$;

-- 1b) Gercekten yetersiz bakiye HALA reddedilmeli (guard gevsemedi mi).
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'f1000000-0000-4000-8000-000000000011';
  v_expense uuid := 'f1000000-0000-4000-8000-000000000012';
  v_rejected boolean := false;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_bank, v_user, 'Test Bank', 'Vadesiz F2', 'banka_karti', 100);
  insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, status, posted_at)
  values (v_expense, v_user, v_bank, current_date, 100, 'Market', 'Market', 'posted', now());
  update public.cards set current_balance = 0 where id = v_bank;

  begin
    -- Iade sonrasi 100 TL var; 250 TL istemek yetersiz kalmali.
    perform public.update_card_expense(v_expense, 250, 'Market', current_date, 1, 'Market', null);
  exception
    when others then
      v_rejected := true;
      if position('yetersiz' in sqlerrm) = 0 then
        raise exception 'BASARISIZ: beklenmeyen hata (%).', sqlerrm;
      end if;
  end;

  if not v_rejected then
    raise exception 'BASARISIZ: gercekten yetersiz bakiye kabul edildi.';
  end if;

  raise notice 'GECTI: yetersiz bakiye hala reddediliyor.';
end;
$$;

-- 2) reset_card_import_data on-kosul mesaji: ODENMIS ekstreye bagli taksit
-- gecmisi temiz ice aktarimla yeniden kurulamaz. (Diger on-kosul — erken odeme
-- settlement'i — burada kurulamiyor: settlement baglantisini yalnizca kart
-- borcu odeme RPC'si yazabilir, guard trigger elle insert'i reddeder. Bu da
-- zaten korumanin calistiginin kaniti.)
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid := 'f2000000-0000-4000-8000-000000000001';
  v_archive uuid := 'f2000000-0000-4000-8000-000000000002';
  v_expense uuid := 'f2000000-0000-4000-8000-000000000003';
  v_message text := '';
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, current_period_spending)
  values (v_card, v_user, 'Test Bank', 'Reset F Kart', 'kredi_karti', 50000, 1000, 1000);

  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status, paid_at
  )
  values (v_archive, v_user, v_card, 2026, 5, '2026-05-25', 1000, 1000, 1000, 'paid', now());

  insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, installment_count, status, posted_at, statement_archive_id)
  values (v_expense, v_user, v_card, '2026-05-10', 1000, 'Odenmis plan', 'Diğer', 2, 'posted', now(), v_archive);

  insert into public.card_installments (
    user_id, card_id, card_expense_id, installment_no, installment_count,
    due_month, amount, description, category, status, statement_archive_id
  )
  values (v_user, v_card, v_expense, 1, 2, '2026-05-10', 500, 'Odenmis plan', 'Diğer', 'posted', v_archive);

  begin
    perform public.reset_card_import_data(v_card);
    raise exception 'BASARISIZ: odenmis ekstreye bagli kart sifirlanabildi.';
  exception
    when others then
      v_message := sqlerrm;
  end;

  if position('Ödenmiş ekstreye bağlı' in v_message) = 0 then
    raise exception 'BASARISIZ: anlamli on-kosul mesaji gelmedi (%).', v_message;
  end if;

  raise notice 'GECTI: reset_card_import_data anlamli on-kosul mesaji veriyor.';
end;
$$;

rollback;
