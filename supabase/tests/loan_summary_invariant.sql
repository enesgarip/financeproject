-- Kredi özeti invariant'ı: loans.remaining_* HER zaman ödenmemiş taksitlerin
-- projeksiyonuna eşittir — tekil ve TOPLU insert/update/delete altında.
--
-- Bu test perf turunun "statement-level'e geçmeden önce invariant testi" şartı:
-- satır-başına trigger statement-level'a inerken davranış burada sabitlenir
-- (toplu ekstre-import benzeri yazımlar tek statement'ta çok satır oynatır).
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

create temp table _expect (loan_id uuid, amt numeric, cnt int);

create or replace function pg_temp.assert_loan_summary(p_loan uuid, p_label text)
returns void language plpgsql as $$
declare
  v_amt numeric; v_cnt int; v_status text;
  e_amt numeric; e_cnt int;
begin
  select remaining_amount, remaining_installments, status into v_amt, v_cnt, v_status
  from public.loans where id = p_loan;
  select coalesce(sum(amount), 0), count(*) into e_amt, e_cnt
  from public.loan_installments where loan_id = p_loan and status <> 'ödendi';
  if v_amt <> e_amt or v_cnt <> e_cnt then
    raise exception 'BAŞARISIZ [%]: özet (%.2f / %) ≠ projeksiyon (%.2f / %).', p_label, v_amt, v_cnt, e_amt, e_cnt;
  end if;
  if (e_cnt = 0 and v_status <> 'closed') or (e_cnt > 0 and v_status <> 'active') then
    raise exception 'BAŞARISIZ [%]: status % taksit sayısıyla (%) çelişiyor.', p_label, v_status, e_cnt;
  end if;
end $$;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_loan1 uuid; v_loan2 uuid;
begin
  insert into public.loans (user_id, bank_name, loan_name, total_amount, remaining_amount, monthly_payment, remaining_installments, status)
  values (v_user, 'Test', 'Invariant K1', 12000, 0, 1000, 0, 'active') returning id into v_loan1;
  insert into public.loans (user_id, bank_name, loan_name, total_amount, remaining_amount, monthly_payment, remaining_installments, status)
  values (v_user, 'Test', 'Invariant K2', 6000, 0, 2000, 0, 'active') returning id into v_loan2;

  -- 1) TOPLU insert (tek statement, iki krediye 12+3 satır) → iki özet de doğru.
  insert into public.loan_installments (user_id, loan_id, installment_no, due_date, amount, status)
  select v_user, v_loan1, gs, current_date + (gs * 30), 1000, 'bekliyor' from generate_series(1, 12) gs;
  insert into public.loan_installments (user_id, loan_id, installment_no, due_date, amount, status)
  select v_user, v_loan2, gs, current_date + (gs * 30), 2000, 'bekliyor' from generate_series(1, 3) gs;
  perform pg_temp.assert_loan_summary(v_loan1, 'toplu insert L1');
  perform pg_temp.assert_loan_summary(v_loan2, 'toplu insert L2');

  -- 2) TOPLU update (tek statement 4 taksit ödendi) → özet düşer.
  update public.loan_installments set status = 'ödendi', paid_at = now()
  where loan_id = v_loan1 and installment_no <= 4;
  perform pg_temp.assert_loan_summary(v_loan1, 'toplu update');

  -- 3) DELETE (son 2 taksit silindi) → özet yeniden hesaplanır.
  delete from public.loan_installments where loan_id = v_loan1 and installment_no > 10;
  perform pg_temp.assert_loan_summary(v_loan1, 'delete');

  -- 4) Kalanların tamamı ödenince kredi kapanır (status = closed).
  update public.loan_installments set status = 'ödendi', paid_at = now()
  where loan_id = v_loan2 and status <> 'ödendi';
  perform pg_temp.assert_loan_summary(v_loan2, 'tam kapanış');

  -- 5) Tek statement'ta İKİ krediye dokunan update → ikisi de tutarlı.
  update public.loan_installments set amount = amount
  where loan_id in (v_loan1, v_loan2);
  perform pg_temp.assert_loan_summary(v_loan1, 'çok-kredi statement L1');
  perform pg_temp.assert_loan_summary(v_loan2, 'çok-kredi statement L2');

  raise notice 'loan_summary_invariant: tüm kontroller geçti';
end $$;

rollback;
