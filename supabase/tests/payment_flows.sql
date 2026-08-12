-- Dort temel odeme/hareket RPC'sinin dogrudan testleri (denetim 2026-08-12 §8/4):
-- a) pay_payment            b) pay_loan_installment (sync_loan_summary dahil)
-- c) transfer_between_accounts   d) record_manual_account_movement (+account_ledger)
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Ortak kurulum: iki banka hesabi.
do $$
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values
    ('f2000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Test Bank', 'Ana Hesap', 'banka_karti', 8000),
    ('f2000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Test Bank', 'Yedek Hesap', 'banka_karti', 2000);
end;
$$;

-- ── a) pay_payment: bekleyen odeme banka hesabindan odenir ────────────────────
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'f2000000-0000-4000-8000-000000000001';
  v_payment uuid := 'f2000000-0000-4000-8000-000000000010';
  v_paid public.payments%rowtype;
  v_balance numeric;
  v_count integer;
begin
  insert into public.payments (id, user_id, title, category, amount, due_date, status)
  values (v_payment, v_user, 'Elektrik', 'Fatura', 750, current_date, 'bekliyor');

  v_paid := public.pay_payment(v_payment, v_bank);

  if v_paid.status <> 'ödendi' then
    raise exception 'BASARISIZ a: odeme durumu odendi degil (%).', v_paid.status;
  end if;

  select current_balance into v_balance from public.cards where id = v_bank;
  if v_balance <> 7250 then
    raise exception 'BASARISIZ a: bakiye 8000-750=7250 beklenirken %.', v_balance;
  end if;

  select count(*) into v_count
  from public.transaction_history
  where source_table = 'payments' and source_id = v_payment and type = 'payment';
  if v_count <> 1 then
    raise exception 'BASARISIZ a: 1 history kaydi beklenirken %.', v_count;
  end if;

  raise notice 'GECTI a: pay_payment (durum + bakiye + history).';
end;
$$;

-- ── b) pay_loan_installment: taksit odenir, sync_loan_summary ozeti dusurur ──
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_bank uuid := 'f2000000-0000-4000-8000-000000000001';
  v_loan uuid := 'f2000000-0000-4000-8000-000000000020';
  v_inst1 uuid := 'f2000000-0000-4000-8000-000000000021';
  v_inst2 uuid := 'f2000000-0000-4000-8000-000000000022';
  v_paid public.loan_installments%rowtype;
  v_loan_row public.loans%rowtype;
  v_balance numeric;
begin
  insert into public.loans (id, user_id, bank_name, loan_name, total_amount, remaining_amount, monthly_payment, remaining_installments, status)
  values (v_loan, v_user, 'Test Bank', 'Ihtiyac Kredisi', 5400, 1800, 900, 2, 'active');

  -- Insert'ler sync_loan_summary trigger'ini tetikler: ozet 1800/2'ye oturur.
  insert into public.loan_installments (id, user_id, loan_id, installment_no, due_date, amount, status)
  values
    (v_inst1, v_user, v_loan, 1, current_date - 5, 900, 'bekliyor'),
    (v_inst2, v_user, v_loan, 2, current_date + 25, 900, 'bekliyor');

  select * into v_loan_row from public.loans where id = v_loan;
  if v_loan_row.remaining_amount <> 1800 or v_loan_row.remaining_installments <> 2 then
    raise exception 'ONKOSUL BOZUK b: trigger ozeti 1800/2 kurmadi (%/%).',
      v_loan_row.remaining_amount, v_loan_row.remaining_installments;
  end if;

  v_paid := public.pay_loan_installment(v_inst1, v_bank);

  if v_paid.status <> 'ödendi' or v_paid.paid_at is null then
    raise exception 'BASARISIZ b: taksit odendi/paid_at bekleniyordu (%, %).', v_paid.status, v_paid.paid_at;
  end if;

  select * into v_loan_row from public.loans where id = v_loan;
  if v_loan_row.remaining_amount <> 900 or v_loan_row.remaining_installments <> 1 or v_loan_row.status <> 'active' then
    raise exception 'BASARISIZ b: kredi ozeti 900/1/active beklenirken %/%/%.',
      v_loan_row.remaining_amount, v_loan_row.remaining_installments, v_loan_row.status;
  end if;

  select current_balance into v_balance from public.cards where id = v_bank;
  if v_balance <> 6350 then
    raise exception 'BASARISIZ b: bakiye 7250-900=6350 beklenirken %.', v_balance;
  end if;

  raise notice 'GECTI b: pay_loan_installment (taksit + ozet projeksiyonu + bakiye).';
end;
$$;

-- ── c) transfer_between_accounts: iki bakiye + history ───────────────────────
do $$
declare
  v_source uuid := 'f2000000-0000-4000-8000-000000000001';
  v_target uuid := 'f2000000-0000-4000-8000-000000000002';
  v_balance numeric;
  v_count integer;
begin
  perform public.transfer_between_accounts(v_source, v_target, 1000, 'Test transferi');

  select current_balance into v_balance from public.cards where id = v_source;
  if v_balance <> 5350 then
    raise exception 'BASARISIZ c: kaynak bakiye 6350-1000=5350 beklenirken %.', v_balance;
  end if;

  select current_balance into v_balance from public.cards where id = v_target;
  if v_balance <> 3000 then
    raise exception 'BASARISIZ c: hedef bakiye 2000+1000=3000 beklenirken %.', v_balance;
  end if;

  select count(*) into v_count
  from public.transaction_history
  where source_table = 'cards' and source_id = v_source and type = 'transfer'
    and title = 'Hesaplar arasi transfer';
  if v_count <> 1 then
    raise exception 'BASARISIZ c: 1 transfer history kaydi beklenirken %.', v_count;
  end if;

  raise notice 'GECTI c: transfer_between_accounts (bakiyeler + history).';
end;
$$;

-- ── d) record_manual_account_movement: giris/cikis + account_ledger event ────
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_account uuid := 'f2000000-0000-4000-8000-000000000003';
  v_balance numeric;
  v_count integer;
  v_sum bigint;
begin
  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_account, v_user, 'Test Bank', 'Hareket Hesabi', 'banka_karti', 500);

  perform public.record_manual_account_movement(v_account, 250, 'in', 'Nakit yatirma');
  perform public.record_manual_account_movement(v_account, 100, 'out', 'Nakit cekme');

  select current_balance into v_balance from public.cards where id = v_account;
  if v_balance <> 650 then
    raise exception 'BASARISIZ d: bakiye 500+250-100=650 beklenirken %.', v_balance;
  end if;

  select count(*) into v_count
  from public.account_ledger
  where card_id = v_account and kind = 'deposit' and amount_kurus = 25000;
  if v_count <> 1 then
    raise exception 'BASARISIZ d: 25000 kurusluk deposit eventi bulunamadi (%).', v_count;
  end if;

  select count(*) into v_count
  from public.account_ledger
  where card_id = v_account and kind = 'withdrawal' and amount_kurus = -10000;
  if v_count <> 1 then
    raise exception 'BASARISIZ d: -10000 kurusluk withdrawal eventi bulunamadi (%).', v_count;
  end if;

  -- Ledger projeksiyonu (opening 50000 dahil) bakiyeyle ayni olmali.
  select coalesce(sum(amount_kurus), 0) into v_sum from public.account_ledger where card_id = v_account;
  if v_sum <> 65000 then
    raise exception 'BASARISIZ d: ledger toplami 65000 kurus beklenirken %.', v_sum;
  end if;

  raise notice 'GECTI d: record_manual_account_movement (bakiye + ledger eventleri).';
end;
$$;

rollback;
