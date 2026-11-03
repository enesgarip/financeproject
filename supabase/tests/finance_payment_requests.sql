-- Gerçek domain RPC + makbuz: tekrar, farklı niyet, rollback, ownership ve reset.
begin;
insert into auth.users(id,email) values('22222222-2222-2222-2222-222222222222','payment-requests-security@example.test') on conflict(id) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
declare
  u uuid := auth.uid();
  bank uuid; debt uuid; lent uuid; cc uuid; archive uuid; bill uuid; loan uuid; installment uuid;
  other_bank uuid; other_debt uuid;
  request uuid := gen_random_uuid(); args jsonb; rejected boolean;
  balance numeric; event_count bigint; after_count bigint;
begin
  insert into public.cards(user_id,bank_name,card_name,card_type,current_balance)
    values(u,'Test','Makbuz hesabı','banka_karti',10000) returning id into bank;
  insert into public.debts(user_id,person_name,direction,value_type,amount,estimated_value_try,status)
    values(u,'Makbuz borcu','borç_aldım','TRY',1000,1000,'açık') returning id into debt;
  args := jsonb_build_object('p_debt_id',debt,'p_account_card_id',bank,'p_amount',100,'p_skip_account_move',false);
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  select count(*) into event_count from public.account_ledger where card_id=bank;
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  select count(*) into after_count from public.account_ledger where card_id=bank;
  if after_count <> event_count or (select current_balance from public.cards where id=bank) <> 9900
    or (select estimated_value_try from public.debts where id=debt) <> 900 then
    raise exception 'Kayıp yanıt tekrarı ikinci kez para/ledger değiştirdi';
  end if;
  if (select count(*) from public.transaction_history where source_id=debt) <> 1 then
    raise exception 'Kayıp yanıt tekrarı geçmişi çoğalttı';
  end if;
  rejected := false;
  begin
    perform public.submit_finance_payment(request,'settle_personal_debt',args || '{"p_amount":200}'::jsonb);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Aynı kimlikle farklı tutar kabul edildi'; end if;
  rejected := false;
  begin perform public.submit_finance_payment(request,'pay_card_debt',args);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Aynı kimlikle farklı aksiyon kabul edildi'; end if;
  -- Yeni niyet aynı tutarı gerçekten bir kez daha ödeyebilir.
  perform public.submit_finance_payment(gen_random_uuid(),'settle_personal_debt',args);
  if (select current_balance from public.cards where id=bank) <> 9800 then
    raise exception 'Ayrı ödeme niyeti uygulanmadı'; end if;
  -- Başarısız işlem makbuz bırakmaz; aynı kimlikle düzeltilmiş istek çalışır.
  request := gen_random_uuid(); rejected := false;
  begin
    perform public.submit_finance_payment(request,'settle_personal_debt',args || '{"p_amount":99999}'::jsonb);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Fazla ödeme kabul edildi'; end if;
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  if (select current_balance from public.cards where id=bank) <> 9700 then
    raise exception 'Rollback sonrası aynı kimlikle düzeltme çalışmadı'; end if;
  -- Tam kapama tekrarında hedef artık kapalı olsa bile makbuz önce kontrol edilir.
  request := gen_random_uuid(); args := args || '{"p_amount":null}'::jsonb;
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  if (select current_balance from public.cards where id=bank) <> 9000 then raise exception 'Tam kapama tekrar bozuk'; end if;
  -- Alacak yönü ve SMS ile bakiye zaten hareket etmiş seçeneği.
  insert into public.debts(user_id,person_name,direction,value_type,amount,estimated_value_try,status)
    values(u,'Makbuz alacağı','borç_verdim','TRY',500,500,'açık') returning id into lent;
  args := jsonb_build_object('p_debt_id',lent,'p_account_card_id',bank,'p_amount',100,'p_skip_account_move',false);
  request:=gen_random_uuid();
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  if (select current_balance from public.cards where id=bank) <> 9100 then raise exception 'Tahsilat tekrarı bozuk'; end if;
  request:=gen_random_uuid(); args:=args || '{"p_skip_account_move":true}'::jsonb;
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  perform public.submit_finance_payment(request,'settle_personal_debt',args);
  if (select current_balance from public.cards where id=bank) <> 9100 then raise exception 'SMS bakiyesi yeniden oynadı'; end if;
  -- Kartın hem ekstre hem borç ödeme yolları.
  insert into public.cards(user_id,bank_name,card_name,card_type,debt_amount,statement_debt_amount,credit_limit)
    values(u,'Test','Makbuz kartı','kredi_karti',1000,1000,10000) returning id into cc;
  insert into public.card_statement_archives(user_id,card_id,period_year,period_month,statement_date,due_date,statement_debt_amount,status)
    values(u,cc,extract(year from current_date)::int,extract(month from current_date)::int,current_date,current_date+10,1000,'open') returning id into archive;
  request:=gen_random_uuid(); args:=jsonb_build_object('p_statement_id',archive,'p_source_card_id',bank,'p_amount',100,'p_skip_source_debit',false);
  perform public.submit_finance_payment(request,'pay_card_statement',args);
  perform public.submit_finance_payment(request,'pay_card_statement',args);
  if (select count(*) from public.card_statement_payments where statement_archive_id=archive) <> 1 then raise exception 'Ekstre ödemesi çoğaldı'; end if;
  request:=gen_random_uuid(); args:=jsonb_build_object('p_card_id',cc,'p_source_card_id',bank,'p_amount',100,'p_skip_source_debit',false);
  select current_balance into balance from public.cards where id=bank;
  perform public.submit_finance_payment(request,'pay_card_debt',args);
  perform public.submit_finance_payment(request,'pay_card_debt',args);
  if (select current_balance from public.cards where id=bank) <> balance-100 then raise exception 'Kart borcu ödemesi çoğaldı'; end if;
  -- Takip dışından planlı ödeme; gerçek ödeme günü korunur.
  insert into public.payments(user_id,title,amount,due_date,status,recurrence)
    values(u,'Makbuz faturası',100,current_date,'bekliyor','none') returning id into bill;
  request:=gen_random_uuid(); args:=jsonb_build_object('p_payment_id',bill,'p_source_card_id',null,'p_paid_amount',100,'p_paid_at',current_date-1,'p_outside_accounts',true);
  select current_balance into balance from public.cards where id=bank;
  perform public.submit_finance_payment(request,'pay_payment',args);
  perform public.submit_finance_payment(request,'pay_payment',args);
  if (select current_balance from public.cards where id=bank) <> balance
    or (select count(*) from public.transaction_history where source_id=bill) <> 1 then raise exception 'Takip dışı ödeme tekrarı bozuk'; end if;
  -- Kredi taksidi aynı wrapper'da eski RPC'nin sıra/ownership kuralını kullanır.
  insert into public.loans(user_id,bank_name,loan_name,total_amount,remaining_amount,monthly_payment,remaining_installments,status)
    values(u,'Test','Makbuz kredisi',100,100,100,1,'active') returning id into loan;
  insert into public.loan_installments(user_id,loan_id,installment_no,due_date,amount,status)
    values(u,loan,1,current_date,100,'bekliyor') returning id into installment;
  request:=gen_random_uuid(); args:=jsonb_build_object('p_installment_id',installment,'p_source_card_id',bank,'p_paid_at',current_date-1);
  perform public.submit_finance_payment(request,'pay_loan_installment',args);
  perform public.submit_finance_payment(request,'pay_loan_installment',args);
  perform set_config('test.payment_request_id',request::text,true);
  perform set_config('test.payment_request_args',args::text,true);
  if (select count(*) from public.transaction_history where source_id=installment) <> 1 then raise exception 'Kredi ödemesi çoğaldı'; end if;
  -- auth.uid olmayan ve yanlış kullanıcı kimlikleri domain'de reddedilir.
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
  insert into public.cards(user_id,bank_name,card_name,card_type,current_balance)
    values(auth.uid(),'Test','Diğer kullanıcı','banka_karti',500) returning id into other_bank;
  insert into public.debts(user_id,person_name,direction,value_type,amount,estimated_value_try,status)
    values(auth.uid(),'Diğer kullanıcı borcu','borç_aldım','TRY',100,100,'açık') returning id into other_debt;
  perform public.submit_finance_payment(request,'settle_personal_debt',jsonb_build_object('p_debt_id',other_debt,'p_account_card_id',other_bank,'p_amount',10));
  if (select current_balance from public.cards where id=other_bank) <> 490 then
    raise exception 'Aynı kimlik diğer kullanıcının makbuzuyla karıştı'; end if;
  rejected:=false;
  begin perform public.submit_finance_payment(gen_random_uuid(),'settle_personal_debt',jsonb_build_object('p_debt_id',lent,'p_account_card_id',bank,'p_amount',1));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Başkasının borcuna erişildi'; end if;
  perform set_config('request.jwt.claims','{}',true); rejected:=false;
  begin perform public.submit_finance_payment(gen_random_uuid(),'pay_payment',args);
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Oturumsuz ödeme kabul edildi'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end;
$$;
reset role;
do $$ begin
  if has_table_privilege('authenticated','private.finance_payment_requests','INSERT')
    or has_table_privilege('authenticated','private.finance_payment_requests','SELECT')
    or has_function_privilege('anon','public.submit_finance_payment(uuid,text,jsonb)','EXECUTE') then
    raise exception 'Makbuz/RPC yetkileri açık'; end if;
  if not exists(select 1 from private.finance_payment_requests where user_id='11111111-1111-1111-1111-111111111111') then
    raise exception 'Ödemeler transaction makbuzu üretmedi'; end if;
end $$;
set local role authenticated;
select public.reset_user_finance_data();
-- Reset sonrasında da eski niyet başarılı bir no-op; silinen kaynağa tekrar yazmaz.
select public.submit_finance_payment(current_setting('test.payment_request_id')::uuid,'pay_loan_installment',current_setting('test.payment_request_args')::jsonb);
reset role;
do $$ begin
  if exists(select 1 from public.cards where user_id='11111111-1111-1111-1111-111111111111') then
    raise exception 'Reset finans verilerini silmedi'; end if;
  if not exists(select 1 from private.finance_payment_requests where user_id='11111111-1111-1111-1111-111111111111') then
    raise exception 'Reset tekrar korumasını kaybettirdi'; end if;
  if not exists(select 1 from private.finance_payment_requests where user_id='22222222-2222-2222-2222-222222222222') then
    raise exception 'Reset diğer kullanıcının makbuzunu sildi'; end if;
  raise notice 'Ödeme makbuzu: 5 RPC, tekrar/rollback/ownership/reset geçti.';
end $$;
rollback;
