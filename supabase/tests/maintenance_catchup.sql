-- Otomatik bakım (catch-up) invariant'ı.
--
-- Uygulama açılışında sırayla `post_due_card_auto_payments`,
-- `post_due_card_installments`, `cut_due_card_statements` koşar. Kullanıcı
-- uygulamayı birkaç gün açmadıysa bu çağrılar birikmiş işi yakalar — en yüksek
-- hasarlı hata sınıfı budur: aynı işin İKİ KEZ yapılması (çift ekstre, çift
-- ödeme) sessizce parayı bozar.
--
-- Bu test tek şeyi kanıtlar: bakım çağrıları İDEMPOTENT. İkinci koşu hiçbir
-- yeni satır/borç hareketi üretmemeli.
--
-- Çalıştırma: npm run db:test:catchup (yerel docker + seed gerekir)
-- Her şey transaction içinde kurulur ve sonunda ROLLBACK edilir; seed verisi
-- kirlenmez.

begin;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_statement_day integer;
  v_archives_after_first integer;
  v_archives_after_second integer;
  v_debt_after_first numeric;
  v_debt_after_second numeric;
  v_statement_debt numeric;
  v_current_after numeric;
  v_ledger_after_first integer;
  v_ledger_after_second integer;
  v_failures text[] := '{}';
begin
  -- Kesim günü DÜN olsun: cut_due_card_statements yalnız kesim günü tamamen
  -- geçtiyse keser (current_date > boundary), yani bugün kesilebilir olmalı.
  v_statement_day := extract(day from (current_date - interval '1 day'))::integer;

  insert into public.cards (
    user_id, bank_name, card_name, card_type, credit_limit,
    debt_amount, statement_debt_amount, current_period_spending, provision_amount,
    statement_day, due_day, current_balance
  )
  values (
    v_user, 'Test Bank', 'Catchup Test Karti', 'kredi_karti', 50000,
    1500, 0, 1500, 0,
    v_statement_day, least(v_statement_day + 5, 28), 0
  )
  returning id into v_card;

  -- ── 1. koşu ───────────────────────────────────────────────────────────────
  perform public.post_due_card_auto_payments();
  perform public.post_due_card_installments();
  perform public.cut_due_card_statements();

  select count(*) into v_archives_after_first
  from public.card_statement_archives where card_id = v_card;

  select debt_amount, statement_debt_amount, current_period_spending
  into v_debt_after_first, v_statement_debt, v_current_after
  from public.cards where id = v_card;

  select count(*) into v_ledger_after_first
  from public.card_ledger where card_id = v_card;

  if v_archives_after_first <> 1 then
    v_failures := v_failures || format('  - ilk kosuda 1 ekstre bekleniyordu, %s olustu', v_archives_after_first);
  end if;

  if v_statement_debt <> 1500 then
    v_failures := v_failures || format('  - kesim sonrasi ekstre borcu 1500 olmaliydi, %s', v_statement_debt);
  end if;

  if v_current_after <> 0 then
    v_failures := v_failures || format('  - kesim sonrasi donem ici harcama 0 olmaliydi, %s', v_current_after);
  end if;

  if v_debt_after_first <> 1500 then
    v_failures := v_failures || format('  - kesim toplam borcu degistirmemeliydi (1500), %s', v_debt_after_first);
  end if;

  -- ── 2. koşu (catch-up tekrarı) ────────────────────────────────────────────
  perform public.post_due_card_auto_payments();
  perform public.post_due_card_installments();
  perform public.cut_due_card_statements();

  select count(*) into v_archives_after_second
  from public.card_statement_archives where card_id = v_card;

  select debt_amount into v_debt_after_second
  from public.cards where id = v_card;

  select count(*) into v_ledger_after_second
  from public.card_ledger where card_id = v_card;

  if v_archives_after_second <> v_archives_after_first then
    v_failures := v_failures || format(
      '  - IDEMPOTENT DEGIL: ikinci kosu ekstre sayisini %s -> %s yapti',
      v_archives_after_first, v_archives_after_second
    );
  end if;

  if v_debt_after_second <> v_debt_after_first then
    v_failures := v_failures || format(
      '  - IDEMPOTENT DEGIL: ikinci kosu borcu %s -> %s yapti',
      v_debt_after_first, v_debt_after_second
    );
  end if;

  if v_ledger_after_second <> v_ledger_after_first then
    v_failures := v_failures || format(
      '  - IDEMPOTENT DEGIL: ikinci kosu %s yeni ledger olayi yazdi',
      v_ledger_after_second - v_ledger_after_first
    );
  end if;

  if array_length(v_failures, 1) > 0 then
    raise exception E'Bakim catch-up invariant ihlali:\n%', array_to_string(v_failures, E'\n');
  end if;

  raise notice 'Bakim catch-up OK: ekstre=%, borc=%, ledger olayi=%',
    v_archives_after_second, v_debt_after_second, v_ledger_after_second;
end $$;

rollback;
