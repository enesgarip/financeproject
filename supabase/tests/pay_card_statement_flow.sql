-- pay_card_statement mutlu yol testi (denetim 2026-08-12 §8/2: dogrudan testi yoktu).
-- 1) Normal odeme: arsiv paid + paid_at + payment_source_card_id dolu, banka
--    bakiyesi ekstre tutari kadar duser, kart kovasi/borcu sifirlanir.
-- 2) B4 dali (p_skip_source_debit=true): bakiye banka/SMS tarafindan zaten
--    dusulmusse arsiv yine kapanir ama bakiye IKINCI kez dusmez.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'f0000000-0000-4000-8000-000000000001';
  v_card uuid := 'f0000000-0000-4000-8000-000000000002';
  v_archive uuid := 'f0000000-0000-4000-8000-000000000003';
  v_card2 uuid := 'f0000000-0000-4000-8000-000000000004';
  v_archive2 uuid := 'f0000000-0000-4000-8000-000000000005';
  v_bank_row public.cards%rowtype;
  v_card_row public.cards%rowtype;
  v_paid public.card_statement_archives%rowtype;
  v_count integer;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_bank, v_user, 'Test Bank', 'Vadesiz', 'banka_karti', 10000);

  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, statement_debt_amount)
  values (v_card, v_user, 'Test Bank', 'Ekstre Karti', 'kredi_karti', 50000, 5000, 5000);

  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status
  )
  values (
    v_archive, v_user, v_card,
    extract(year from current_date)::integer, extract(month from current_date)::integer, current_date,
    5000, 5000, 5000, 'open'
  );

  -- ── 1) Mutlu yol: normal odeme ─────────────────────────────────────────────
  v_paid := public.pay_card_statement(v_archive, v_bank, false);

  if v_paid.status <> 'paid' then
    raise exception 'BASARISIZ: arsiv paid olmadi (%).', v_paid.status;
  end if;
  if v_paid.paid_at is null then
    raise exception 'BASARISIZ: paid_at bos kaldi.';
  end if;
  if v_paid.payment_source_card_id is distinct from v_bank then
    raise exception 'BASARISIZ: payment_source_card_id kaynak hesabi gostermiyor (%).', v_paid.payment_source_card_id;
  end if;

  select * into v_bank_row from public.cards where id = v_bank;
  if v_bank_row.current_balance <> 5000 then
    raise exception 'BASARISIZ: banka bakiyesi 5000 beklenirken % (ekstre tutari dusmedi?).', v_bank_row.current_balance;
  end if;

  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.debt_amount <> 0 or v_card_row.statement_debt_amount <> 0 then
    raise exception 'BASARISIZ: kart borcu sifirlanmadi (debt=%, statement=%).',
      v_card_row.debt_amount, v_card_row.statement_debt_amount;
  end if;

  select count(*) into v_count
  from public.transaction_history
  where source_table = 'card_statement_archives' and source_id = v_archive and type = 'payment';
  if v_count <> 1 then
    raise exception 'BASARISIZ: ekstre odemesi icin 1 history kaydi beklenirken %.', v_count;
  end if;

  -- ── 2) B4 dali: p_skip_source_debit=true bakiyeyi dusurmez ─────────────────
  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, statement_debt_amount)
  values (v_card2, v_user, 'Test Bank', 'Skip Karti', 'kredi_karti', 50000, 3000, 3000);

  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status
  )
  values (
    v_archive2, v_user, v_card2,
    extract(year from current_date)::integer, extract(month from current_date)::integer, current_date,
    3000, 3000, 3000, 'open'
  );

  v_paid := public.pay_card_statement(v_archive2, v_bank, true);

  if v_paid.status <> 'paid' or v_paid.paid_at is null or v_paid.payment_source_card_id is distinct from v_bank then
    raise exception 'BASARISIZ: skip dalinda arsiv kapanisi eksik (status=%, paid_at=%, source=%).',
      v_paid.status, v_paid.paid_at, v_paid.payment_source_card_id;
  end if;

  select * into v_bank_row from public.cards where id = v_bank;
  if v_bank_row.current_balance <> 5000 then
    raise exception 'BASARISIZ: skip dalinda bakiye degismemeliydi (5000 beklenirken %).', v_bank_row.current_balance;
  end if;

  select * into v_card_row from public.cards where id = v_card2;
  if v_card_row.debt_amount <> 0 or v_card_row.statement_debt_amount <> 0 then
    raise exception 'BASARISIZ: skip dalinda kart borcu sifirlanmadi (debt=%, statement=%).',
      v_card_row.debt_amount, v_card_row.statement_debt_amount;
  end if;

  raise notice 'GECTI: pay_card_statement mutlu yol + skip_source_debit dali dogru.';
end;
$$;

rollback;
