-- Ledger trigger projeksiyon butunlugu (denetim 2026-08-12 §8/5):
-- a) card_ledger: opening + debit + reclass + credit eventlerinin kurus toplami
--    cards.debt_amount'a; kova deltalarinin toplami kova degerlerine esit.
-- b) account_ledger: event toplami = current_balance.
-- c) app.ledger_suppress GUC'u ile yapilan guncelleme event URETMEZ.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid := 'f3000000-0000-4000-8000-000000000001';
  v_account uuid := 'f3000000-0000-4000-8000-000000000002';
  v_card_row public.cards%rowtype;
  v_sum bigint;
  v_stmt_sum bigint;
  v_curr_sum bigint;
  v_prov_sum bigint;
  v_count integer;
  v_count_after integer;
  v_balance numeric;
begin
  -- ── a) Kredi karti: borc + kova projeksiyonu ────────────────────────────────
  -- Acilis: debt=1000 (statement=0, current=800, provision=200) -> opening event.
  insert into public.cards (
    id, user_id, bank_name, card_name, card_type, credit_limit,
    debt_amount, statement_debt_amount, current_period_spending, provision_amount
  )
  values (v_card, v_user, 'Test Bank', 'Ledger Karti', 'kredi_karti', 50000, 1000, 0, 800, 200);

  select count(*) into v_count from public.card_ledger where card_id = v_card and kind = 'opening';
  if v_count <> 1 then
    raise exception 'BASARISIZ a: opening eventi beklenirken % adet.', v_count;
  end if;

  -- 1) Borc artisi (harcama benzeri): debt +500, current +500 -> debit.
  update public.cards
  set debt_amount = debt_amount + 500,
      current_period_spending = current_period_spending + 500
  where id = v_card;

  -- 2) Kova kaymasi (ekstre kesimi benzeri): current -> statement, borc sabit -> reclass.
  update public.cards
  set statement_debt_amount = 600,
      current_period_spending = 700
  where id = v_card;

  select count(*) into v_count from public.card_ledger where card_id = v_card and kind = 'reclass';
  if v_count <> 1 then
    raise exception 'BASARISIZ a: borc degismeden kova kaymasi reclass uretmeliydi (% adet).', v_count;
  end if;

  -- 3) Borc azalisi (odeme benzeri): statement kovasi kapanir -> credit.
  update public.cards
  set debt_amount = debt_amount - 600,
      statement_debt_amount = 0
  where id = v_card;

  select count(*) into v_count from public.card_ledger where card_id = v_card and kind = 'debit';
  if v_count <> 1 then
    raise exception 'BASARISIZ a: 1 debit eventi beklenirken %.', v_count;
  end if;
  select count(*) into v_count from public.card_ledger where card_id = v_card and kind = 'credit';
  if v_count <> 1 then
    raise exception 'BASARISIZ a: 1 credit eventi beklenirken %.', v_count;
  end if;

  select * into v_card_row from public.cards where id = v_card;

  -- Toplam borc projeksiyonu (opening dahil) kart borcuna esit olmali.
  select coalesce(sum(amount_kurus), 0),
         coalesce(sum(statement_delta_kurus), 0),
         coalesce(sum(current_delta_kurus), 0),
         coalesce(sum(provision_delta_kurus), 0)
  into v_sum, v_stmt_sum, v_curr_sum, v_prov_sum
  from public.card_ledger
  where card_id = v_card;

  if v_sum <> round(v_card_row.debt_amount * 100)::bigint then
    raise exception 'BASARISIZ a: ledger toplami % kurus, kart borcu % TL — projeksiyon kirildi.',
      v_sum, v_card_row.debt_amount;
  end if;
  if v_stmt_sum <> round(v_card_row.statement_debt_amount * 100)::bigint then
    raise exception 'BASARISIZ a: statement delta toplami % kurus, kova % TL.',
      v_stmt_sum, v_card_row.statement_debt_amount;
  end if;
  if v_curr_sum <> round(v_card_row.current_period_spending * 100)::bigint then
    raise exception 'BASARISIZ a: current delta toplami % kurus, kova % TL.',
      v_curr_sum, v_card_row.current_period_spending;
  end if;
  if v_prov_sum <> round(v_card_row.provision_amount * 100)::bigint then
    raise exception 'BASARISIZ a: provision delta toplami % kurus, kova % TL.',
      v_prov_sum, v_card_row.provision_amount;
  end if;

  raise notice 'GECTI a: card_ledger projeksiyonu (borc + kova deltalari) tutarli.';

  -- ── b) Banka hesabi: bakiye projeksiyonu ───────────────────────────────────
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_account, v_user, 'Test Bank', 'Ledger Hesabi', 'banka_karti', 2500);

  update public.cards set current_balance = current_balance + 1000 where id = v_account;
  update public.cards set current_balance = current_balance - 400 where id = v_account;

  select coalesce(sum(amount_kurus), 0) into v_sum from public.account_ledger where card_id = v_account;
  select current_balance into v_balance from public.cards where id = v_account;
  if v_sum <> round(v_balance * 100)::bigint then
    raise exception 'BASARISIZ b: account_ledger toplami % kurus, bakiye % TL.', v_sum, v_balance;
  end if;
  if v_sum <> 310000 then
    raise exception 'BASARISIZ b: 2500+1000-400=3100 TL (310000 kurus) beklenirken %.', v_sum;
  end if;

  raise notice 'GECTI b: account_ledger projeksiyonu bakiyeyle tutarli.';

  -- ── c) app.ledger_suppress: event uretilmez ────────────────────────────────
  select count(*) into v_count from public.account_ledger where card_id = v_account;
  perform set_config('app.ledger_suppress', '1', true);
  update public.cards set current_balance = current_balance + 111 where id = v_account;
  select count(*) into v_count_after from public.account_ledger where card_id = v_account;
  if v_count_after <> v_count then
    raise exception 'BASARISIZ c: suppress altinda account_ledger eventi uretildi (% -> %).', v_count, v_count_after;
  end if;

  select count(*) into v_count from public.card_ledger where card_id = v_card;
  update public.cards set debt_amount = debt_amount + 50, current_period_spending = current_period_spending + 50 where id = v_card;
  select count(*) into v_count_after from public.card_ledger where card_id = v_card;
  if v_count_after <> v_count then
    raise exception 'BASARISIZ c: suppress altinda card_ledger eventi uretildi (% -> %).', v_count, v_count_after;
  end if;

  -- GUC'u sifirla ve trigger'in tekrar calistigini kanitla.
  perform set_config('app.ledger_suppress', '', true);
  select count(*) into v_count from public.account_ledger where card_id = v_account;
  update public.cards set current_balance = current_balance - 111 where id = v_account;
  select count(*) into v_count_after from public.account_ledger where card_id = v_account;
  if v_count_after <> v_count + 1 then
    raise exception 'BASARISIZ c: suppress kalktiktan sonra event uretilmedi.';
  end if;

  raise notice 'GECTI c: app.ledger_suppress event uretimini kapatiyor (ve geri aciliyor).';
end;
$$;

rollback;
