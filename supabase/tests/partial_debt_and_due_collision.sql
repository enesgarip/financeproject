-- BM-8 regresyonu: kısmi kişisel borç ödemesi (D-1) + cut_card_statement
-- due_date çakışma ötelemesi (2d).
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_account uuid;
  v_debt_borrowed uuid;
  v_debt_lent uuid;
  v_balance numeric;
  v_value numeric;
  v_amount numeric;
  v_status text;
  v_failed boolean;
  v_card uuid;
  v_statement_day integer;
  v_archive public.card_statement_archives%rowtype;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, current_balance)
  values (v_user, 'Test', 'Kaynak', 'banka_karti', 0, 5000) returning id into v_account;

  -- ── D-1a: Borç aldım — kısmi ödeme hesaptan düşer, kayıt açık kalır.
  insert into public.debts (user_id, person_name, direction, value_type, amount, estimated_value_try, auto_valued, status)
  values (v_user, 'Ali', 'borç_aldım', 'TRY', 1000, 1000, false, 'açık') returning id into v_debt_borrowed;

  perform public.settle_personal_debt(v_debt_borrowed, v_account, 400);

  select estimated_value_try, amount, status into v_value, v_amount, v_status
  from public.debts where id = v_debt_borrowed;
  if v_value <> 600 or v_status <> 'açık' then
    raise exception 'FAIL D1a kısmi: değer 600/açık bekleniyordu, %/%', v_value, v_status;
  end if;
  if v_amount <> 600 then raise exception 'FAIL D1a amount oransal 600 bekleniyordu, %', v_amount; end if;

  select current_balance into v_balance from public.cards where id = v_account;
  if v_balance <> 4600 then raise exception 'FAIL D1a bakiye 5000-400=4600 bekleniyordu, %', v_balance; end if;

  -- Kalanı tam öde → kapanır, bakiye kalan kadar daha düşer.
  perform public.settle_personal_debt(v_debt_borrowed, v_account, null);
  select status into v_status from public.debts where id = v_debt_borrowed;
  if v_status <> 'kapandı' then raise exception 'FAIL D1a tam kapama: kapandı bekleniyordu, %', v_status; end if;
  select current_balance into v_balance from public.cards where id = v_account;
  if v_balance <> 4000 then raise exception 'FAIL D1a kapama bakiye 4600-600=4000 bekleniyordu, %', v_balance; end if;

  -- ── D-1b: Borç verdim — kısmi tahsilat hesaba eklenir.
  insert into public.debts (user_id, person_name, direction, value_type, amount, estimated_value_try, auto_valued, status)
  values (v_user, 'Veli', 'borç_verdim', 'TRY', 800, 800, false, 'açık') returning id into v_debt_lent;

  perform public.settle_personal_debt(v_debt_lent, v_account, 300);
  select estimated_value_try, status into v_value, v_status from public.debts where id = v_debt_lent;
  if v_value <> 500 or v_status <> 'açık' then
    raise exception 'FAIL D1b kısmi tahsilat: değer 500/açık bekleniyordu, %/%', v_value, v_status;
  end if;
  select current_balance into v_balance from public.cards where id = v_account;
  if v_balance <> 4300 then raise exception 'FAIL D1b tahsilat bakiye 4000+300=4300 bekleniyordu, %', v_balance; end if;

  -- ── D-1c: Değerden fazla ödeme reddedilir.
  v_failed := false;
  begin
    perform public.settle_personal_debt(v_debt_lent, v_account, 9999);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL D1c fazla ödeme reddedilmeliydi'; end if;
  if (select estimated_value_try from public.debts where id = v_debt_lent) <> 500 then
    raise exception 'FAIL D1c reddedilen ödeme değeri değiştirdi';
  end if;

  -- ── 2d: due_day <= statement_day kartta arşiv due_date bir sonraki aya taşınır
  -- (statement_date ile çakışmaz). Kesim günü DÜN olsun ki bugün kesilebilsin.
  v_statement_day := extract(day from (current_date - 1))::integer;
  insert into public.cards (
    user_id, bank_name, card_name, card_type, credit_limit,
    debt_amount, statement_debt_amount, current_period_spending, provision_amount,
    statement_day, due_day, current_balance
  ) values (
    v_user, 'Test', '2d kart', 'kredi_karti', 50000,
    500, 0, 500, 0, v_statement_day, v_statement_day, 0
  ) returning id into v_card;

  -- due_day = statement_day → çakışma; vade bir sonraki döngüye ötelenmeli.
  v_archive := public.cut_card_statement(v_card);
  if v_archive.due_date is null then raise exception 'FAIL 2d due_date null'; end if;
  if v_archive.due_date <= v_archive.statement_date then
    raise exception 'FAIL 2d vade kesimle çakıştı: statement=% due=%', v_archive.statement_date, v_archive.due_date;
  end if;
  -- Öteleme yaklaşık bir ay olmalı (25-35 gün penceresi).
  if (v_archive.due_date - v_archive.statement_date) < 25
     or (v_archive.due_date - v_archive.statement_date) > 35 then
    raise exception 'FAIL 2d öteleme beklenen ~1 ay değil: %', v_archive.due_date - v_archive.statement_date;
  end if;

  raise notice 'Kısmi borç + due_date çakışma regresyonu OK.';
end $$;

rollback;
