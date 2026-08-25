-- Kredi taksit sırası guard'ı (denetim §2): 12. taksit 7.'den önce ödenemez.
--
-- Risk: guard yanlış kurulursa ya sıradaki taksit de reddedilir (kilitlenme)
-- ya da sıra atlaması sessizce geçer (banka gerçeğiyle çelişki geri gelir).
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_loan uuid;
  v_source uuid;
  v_inst1 uuid;
  v_inst2 uuid;
  v_status text;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, current_balance)
  values (v_user, 'Test Bankası', 'Sıra Testi Hesap', 'banka_karti', 50000)
  returning id into v_source;

  insert into public.loans (user_id, bank_name, loan_name, total_amount, remaining_amount, monthly_payment, remaining_installments, status)
  values (v_user, 'Test Bankası', 'Sıra Testi Kredisi', 20000, 20000, 10000, 2, 'active')
  returning id into v_loan;

  insert into public.loan_installments (user_id, loan_id, installment_no, due_date, amount, status)
  values (v_user, v_loan, 1, current_date + 5, 10000, 'bekliyor')
  returning id into v_inst1;
  insert into public.loan_installments (user_id, loan_id, installment_no, due_date, amount, status)
  values (v_user, v_loan, 2, current_date + 35, 10000, 'bekliyor')
  returning id into v_inst2;

  -- 1) Sıra atlaması reddedilir: 1. bekliyorken 2. ödenemez.
  begin
    perform public.pay_loan_installment(v_inst2, v_source);
    raise exception 'BAŞARISIZ: sıra atlaması kabul edildi.';
  exception
    when raise_exception then
      if sqlerrm like 'BAŞARISIZ%' then raise; end if;
  end;

  -- 2) Sıradaki taksit sorunsuz ödenir; ardından sonraki artık sıradadır.
  perform public.pay_loan_installment(v_inst1, v_source);
  perform public.pay_loan_installment(v_inst2, v_source);

  select status into v_status from public.loans where id = v_loan;
  if v_status <> 'closed' then
    raise exception 'BAŞARISIZ: iki taksit ödendi ama kredi kapanmadı (%).', v_status;
  end if;

  raise notice 'loan_installment_order: tüm kontroller geçti';
end $$;

rollback;
