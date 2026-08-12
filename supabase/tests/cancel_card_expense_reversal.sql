-- cancel_card_expense 5b terslemesi (20260810160000; denetim 2026-08-12 §8/6):
-- cok taksitli posted planda borc terslemesi COCUK TAKSIT TOPLAMI kadardir,
-- parent.amount kadar DEGIL.
-- A) add_card_expense plani: cocuk toplami = amount (davranis degismez) —
--    iptal borcu/kovalari tam cocuk toplami kadar geri alir, taksitler silinir.
-- B) Devreden (carryover) plan: parent.amount tam plani tasir ama borca yalniz
--    kalan taksitler girmistir; iptal kalan toplam kadar terslemeli, karttaki
--    DIGER borcu yememelidir (eski regresyon: amount kadar dusuyordu).
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ── A) add_card_expense cok taksitli plan ─────────────────────────────────────
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid := 'f4000000-0000-4000-8000-000000000001';
  v_expense public.card_expenses%rowtype;
  v_cancelled public.card_expenses%rowtype;
  v_card_row public.cards%rowtype;
  v_child_total numeric;
  v_posted_total numeric;
  v_count integer;
  v_history_amount numeric;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit)
  values (v_card, v_user, 'Test Bank', 'Iptal Karti', 'kredi_karti', 50000);

  -- Gecmis tarihli 3 taksitli harcama: bir kismi posted, kalani scheduled olabilir.
  v_expense := public.add_card_expense(v_card, 3100, 'Cok taksitli iptal senaryosu', current_date - 45, 3);

  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where status = 'posted'), 0),
         count(*)
  into v_child_total, v_posted_total, v_count
  from public.card_installments
  where card_expense_id = v_expense.id;

  if v_count <> 3 then
    raise exception 'ONKOSUL BOZUK A: 3 cocuk taksit beklenirken %.', v_count;
  end if;
  if v_child_total <> 3100 then
    raise exception 'ONKOSUL BOZUK A: cocuk toplami 3100 beklenirken % (yuvarlanan son taksit?).', v_child_total;
  end if;

  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.debt_amount <> 3100 then
    raise exception 'ONKOSUL BOZUK A: borc 3100 beklenirken %.', v_card_row.debt_amount;
  end if;

  v_cancelled := public.cancel_card_expense(v_expense.id);

  if v_cancelled.status <> 'cancelled' then
    raise exception 'BASARISIZ A: harcama cancelled olmadi (%).', v_cancelled.status;
  end if;

  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.debt_amount <> 0 then
    raise exception 'BASARISIZ A: borc terslemesi cocuk toplami (%) kadar olmali; kalan %.',
      v_child_total, v_card_row.debt_amount;
  end if;
  if v_card_row.current_period_spending <> 0 then
    raise exception 'BASARISIZ A: donem ici kova posted cocuk toplami (%) kadar dusmeli; kalan %.',
      v_posted_total, v_card_row.current_period_spending;
  end if;

  select count(*) into v_count from public.card_installments where card_expense_id = v_expense.id;
  if v_count <> 0 then
    raise exception 'BASARISIZ A: taksitler temizlenmedi (% satir kaldi).', v_count;
  end if;

  select max(amount) into v_history_amount
  from public.transaction_history
  where source_table = 'card_expenses' and source_id = v_expense.id and type = 'correction';
  if v_history_amount is distinct from v_child_total then
    raise exception 'BASARISIZ A: correction tutari cocuk toplami % beklenirken %.', v_child_total, v_history_amount;
  end if;

  raise notice 'GECTI A: add_card_expense plani iptali cocuk toplami kadar tersledi.';
end;
$$;

-- ── B) Devreden plan: tersleme = kalan cocuk toplami, diger borc korunur ─────
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid := 'f4000000-0000-4000-8000-000000000002';
  v_expense public.card_expenses%rowtype;
  v_card_row public.cards%rowtype;
  v_child_total numeric;
  v_count integer;
  v_history_amount numeric;
begin
  -- Kartta plana AIT OLMAYAN 1000 TL borc var; eski hata (parent.amount kadar
  -- tersleme) bu borcu da silerdi.
  insert into public.cards (
    id, user_id, bank_name, card_name, card_type, credit_limit,
    debt_amount, current_period_spending
  )
  values (v_card, v_user, 'Test Bank', 'Devir Karti', 'kredi_karti', 50000, 1000, 1000);

  -- 6 taksitlik plan (500 TL), 2'si ekstre oncesi odendi: parent.amount=3000,
  -- borca yalniz kalan 4 taksit = 2000 girer.
  v_expense := public.record_card_installment_carryover(
    v_card, 'Devreden taksit plani', 500, 6, 2, (current_date - 10)::date, 'Diğer'
  );

  if v_expense.amount <> 3000 then
    raise exception 'ONKOSUL BOZUK B: parent.amount 3000 beklenirken %.', v_expense.amount;
  end if;

  select coalesce(sum(amount), 0), count(*)
  into v_child_total, v_count
  from public.card_installments
  where card_expense_id = v_expense.id;
  if v_count <> 4 or v_child_total <> 2000 then
    raise exception 'ONKOSUL BOZUK B: 4 kalan taksit / 2000 TL beklenirken % / %.', v_count, v_child_total;
  end if;

  select * into v_card_row from public.cards where id = v_card;
  if v_card_row.debt_amount <> 3000 then
    raise exception 'ONKOSUL BOZUK B: borc 1000+2000=3000 beklenirken %.', v_card_row.debt_amount;
  end if;

  perform public.cancel_card_expense(v_expense.id);

  select * into v_card_row from public.cards where id = v_card;
  -- 5b: tersleme cocuk toplami (2000); plana ait olmayan 1000 TL borc KALIR.
  if v_card_row.debt_amount <> 1000 then
    raise exception 'BASARISIZ B: borc 3000-2000=1000 beklenirken % (parent.amount kadar mi terslendi?).',
      v_card_row.debt_amount;
  end if;

  select max(amount) into v_history_amount
  from public.transaction_history
  where source_table = 'card_expenses' and source_id = v_expense.id and type = 'correction';
  if v_history_amount is distinct from v_child_total then
    raise exception 'BASARISIZ B: correction tutari kalan taksit toplami % beklenirken %.',
      v_child_total, v_history_amount;
  end if;

  select count(*) into v_count from public.card_installments where card_expense_id = v_expense.id;
  if v_count <> 0 then
    raise exception 'BASARISIZ B: taksitler temizlenmedi (% satir kaldi).', v_count;
  end if;

  raise notice 'GECTI B: devreden plan iptali kalan cocuk toplami kadar tersledi, diger borc korundu.';
end;
$$;

rollback;
