begin;
insert into auth.users(id,email) values('22222222-2222-2222-2222-222222222222','linked-workflows-other@example.test') on conflict(id) do nothing;
insert into public.cards(id,user_id,bank_name,card_name,card_type,current_balance) values('aa081400-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222','Test','Other account','banka_karti',1000);
insert into public.debts(id,user_id,person_name,direction,value_type,amount,estimated_value_try,status) values('dd081400-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222','Other receivable','borç_verdim','TRY',100,100,'açık');
insert into public.transaction_history(id,user_id,type,title,amount,source_table,source_id) values('ff081400-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222','transfer','Other para girişi',100,'cards','aa081400-0000-4000-8000-000000000002');
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
declare
 u uuid:=auth.uid(); bank uuid; debt uuid; movement uuid; car uuid; reminder uuid; cc uuid; expense uuid;
 request uuid:=gen_random_uuid(); bad_request uuid:=gen_random_uuid(); input jsonb; backup jsonb;
 r public.car_reminders%rowtype; receipt public.car_service_completions%rowtype;
 balance numeric; events bigint; rejected boolean; old_count bigint; result jsonb;
begin
 insert into public.cards(user_id,bank_name,card_name,card_type,current_balance) values(u,'Test','LOCAL-E2E-gelir','banka_karti',100) returning id into bank;
 perform public.record_manual_account_movement(bank,1000,'in');
 select id into movement from public.transaction_history where source_id=bank and type='transfer';
 insert into public.debts(user_id,person_name,direction,value_type,amount,estimated_value_try,status) values(u,'LOCAL-E2E-alacak','borç_verdim','TRY',1000,1000,'açık') returning id into debt;
 select count(*) into events from public.account_ledger where card_id=bank;
 perform public.classify_account_income(movement,'receivable',debt,400);
 perform public.classify_account_income(movement,'receivable',debt,400);
 if (select current_balance from public.cards where id=bank)<>1100 or (select count(*) from public.account_ledger where card_id=bank)<>events
   or (select estimated_value_try from public.debts where id=debt)<>600 or (select count(*) from public.transaction_history where source_id=debt)<>1 then
  raise exception 'Tahsilat eşleştirmesi para veya geçmişi tekrar yazdı';
 end if;
 rejected:=false; begin perform public.classify_account_income(movement,'salary'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Tamamlanan hareket farklı seçimle tekrar sınıflandırıldı'; end if;
 rejected:=false; begin insert into public.account_income_labels(user_id,movement_id,kind) values(u,movement,'other'); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Sınıflandırma doğrudan yazılabildi'; end if;
 perform public.record_manual_account_movement(bank,200,'in');
 select id into movement from public.transaction_history where source_id=bank and amount=200;
 rejected:=false; begin perform public.classify_account_income(movement,'receivable','dd081400-0000-4000-8000-000000000002',50); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Başka kullanıcının alacağına tahsilat yazıldı'; end if;
 rejected:=false; begin perform public.classify_account_income(movement,'receivable',debt,300); exception when others then rejected:=true; end;
 if not rejected or exists(select 1 from public.account_income_labels where movement_id=movement) then raise exception 'Giriş üstü tahsilat kabul edildi veya makbuz kaldı'; end if;
 rejected:=false; begin perform public.classify_account_income(movement,'receivable',debt,700); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Alacak üstü tahsilat kabul edildi'; end if;
 perform public.classify_account_income(movement,'salary');
 if (select current_balance from public.cards where id=bank)<>1300 then raise exception 'Maaş etiketi yeni para üretti'; end if;
 perform public.record_manual_account_movement(bank,20,'out');
 select id into movement from public.transaction_history where source_id=bank and amount=20;
 rejected:=false; begin perform public.classify_account_income(movement,'other'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Çıkış hareketi gelir sayıldı'; end if;
 -- Historical SMS fixture: a proven automatic debt event already consumed it.
 insert into public.transaction_history(user_id,type,title,amount,source_table,source_id,source_event_id) values(u,'transfer','LOCAL-E2E SMS geldi',10,'cards',bank,'workflow-auto-sms') returning id into movement;
 insert into public.transaction_history(user_id,type,title,amount,source_table,source_id,source_event_id) values(u,'debt','LOCAL-E2E otomatik tahsilat',10,'debts',debt,'workflow-auto-sms');
 rejected:=false; begin perform public.classify_account_income(movement,'receivable',debt,10); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Otomatik SMS tahsilatı ikinci kez eşlendi'; end if;

 insert into public.cars(user_id,name,current_odometer_km) values(u,'LOCAL-E2E araç',50000) returning id into car;
 insert into public.car_reminders(user_id,car_id,title,kind,due_date,due_odometer_km,repeat_months,repeat_km) values(u,car,'LOCAL-E2E bakım','bakim',current_date,50000,6,10000) returning * into r;
 reminder:=r.id;
 input:=jsonb_build_object('reminderId',r.id,'expectedUpdatedAt',r.updated_at,'expectedDueDate',r.due_date,'expectedDueKm',r.due_odometer_km,'completedOn',current_date,'odometerKm',51000,'nextDate',current_date+interval '6 months','nextKm',61000,'expenseMode','manual','existingExpenseId',null,'amount',750,'paymentMethod','nakit');
 select current_balance into balance from public.cards where id=bank;
 receipt:=public.complete_car_service(request,input);
 perform public.complete_car_service(request,input);
 if (select count(*) from public.car_expenses where car_id=car)<>1 or (select current_balance from public.cards where id=bank)<>balance
  or (select due_odometer_km from public.car_reminders where id=reminder)<>61000 or (select current_odometer_km from public.cars where id=car)<>51000 then
  raise exception 'Bakım tekrarı gideri çoğalttı veya işlem atomik değil';
 end if;
 rejected:=false; begin perform public.complete_car_service(request,input||'{"amount":800}'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Aynı bakım kimliği farklı alanlarla kabul edildi'; end if;
 rejected:=false; begin perform public.complete_car_service(gen_random_uuid(),input); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Eski hatırlatıcı sürümü tekrar tamamlandı'; end if;
 select * into r from public.car_reminders where id=reminder;
 input:=input||jsonb_build_object('expectedUpdatedAt',r.updated_at,'expectedDueDate',r.due_date,'expectedDueKm',r.due_odometer_km,'nextDate',current_date-1);
 rejected:=false; begin perform public.complete_car_service(bad_request,input); exception when others then rejected:=true; end;
 if not rejected or exists(select 1 from public.car_service_completions where id=bad_request) or (select count(*) from public.car_expenses where car_id=car)<>1 then raise exception 'Başarısız bakım gider veya makbuz bıraktı'; end if;
 insert into public.cards(user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day) values(u,'Test','LOCAL-E2E kart','kredi_karti',5000,4,14) returning id into cc;
 select id into expense from public.add_card_expense(p_card_id=>cc,p_amount=>200,p_description=>'LOCAL-E2E mevcut bakım',p_spent_at=>current_date,p_status=>'provision',p_category=>'Ulaşım');
 input:=input||jsonb_build_object('nextDate',null,'nextKm',null,'expenseMode','card','existingExpenseId',expense,'amount',null);
 select count(*) into old_count from public.card_ledger where card_id=cc;
 perform public.complete_car_service(gen_random_uuid(),input);
 if exists(select 1 from public.car_reminders where id=reminder) or (select car_id from public.card_expenses where id=expense)<>car or (select count(*) from public.card_ledger where card_id=cc)<>old_count then raise exception 'Mevcut gider tekrar borç yazdı veya hatırlatıcı kapanmadı'; end if;
 -- None mode also persists a completion and creates no reporting expense.
 insert into public.car_reminders(user_id,car_id,title,kind,due_date) values(u,car,'Masrafsız kontrol','diger',current_date) returning * into r;
 input:=input||jsonb_build_object('reminderId',r.id,'expectedUpdatedAt',r.updated_at,'expectedDueDate',r.due_date,'expectedDueKm',r.due_odometer_km,'expenseMode','none','existingExpenseId',null);
 perform public.complete_car_service(gen_random_uuid(),input);
 if (select count(*) from public.car_expenses where car_id=car)<>1 then raise exception 'Masrafsız tamamlamada gider üretildi'; end if;
 -- A complete backup round trip must preserve consumed movements and receipts.
 backup:=jsonb_build_object('schema','financeproject-v2','tables',jsonb_build_object(
  'cards',(select jsonb_agg(to_jsonb(t)) from public.cards t where id in(bank,cc)),
  'debts',(select jsonb_agg(to_jsonb(t)) from public.debts t where id=debt),
  'cars',(select jsonb_agg(to_jsonb(t)) from public.cars t where id=car),
  'card_expenses',(select jsonb_agg(to_jsonb(t)) from public.card_expenses t where id=expense),
  'car_expenses',(select jsonb_agg(to_jsonb(t)) from public.car_expenses t where car_id=car),
  'transaction_history',(select jsonb_agg(to_jsonb(t)) from public.transaction_history t where source_id in(bank,cc,debt)),
  'account_income_labels',(select jsonb_agg(to_jsonb(t)) from public.account_income_labels t),
  'car_service_completions',(select jsonb_agg(to_jsonb(t)) from public.car_service_completions t)));
 result:=public.restore_user_finance_data_tx(backup);
 if (select count(*) from public.account_income_labels)<>2 or (select count(*) from public.car_service_completions)<>3 then raise exception 'Akış kayıtları restore edilmedi'; end if;
 perform public.complete_car_service(request,receipt.request);
 if (select count(*) from public.car_expenses where car_id=car)<>1 then raise exception 'Restore sonrası bakım tekrarı gider çoğalttı'; end if;
 -- Unknown child fields must roll back reset, not discard existing data.
 rejected:=false; begin perform public.restore_user_finance_data_tx(jsonb_set(backup,'{tables,account_income_labels,0,unknown}','1')); exception when others then rejected:=true; end;
 if not rejected or (select count(*) from public.car_service_completions)<>3 then raise exception 'Bozuk restore önceki veriyi korumadı'; end if;
 rejected:=false; begin perform public.restore_user_finance_data_tx(jsonb_set(backup,'{tables,account_income_labels,0,movement_id}','"ff081400-0000-4000-8000-000000000002"')); exception when foreign_key_violation then rejected:=true; end;
 if not rejected or (select count(*) from public.car_service_completions)<>3 then raise exception 'Çapraz sahipli restore reddedilmedi veya eski veriyi sildi'; end if;
 perform set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
 if exists(select 1 from public.account_income_labels) or exists(select 1 from public.car_service_completions) then raise exception 'RLS başka kullanıcının akışlarını gösterdi'; end if;
 rejected:=false; begin perform public.classify_account_income(movement,'other'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Başka kullanıcının hareketi sınıflandırıldı'; end if;
 rejected:=false; begin perform public.complete_car_service(gen_random_uuid(),input); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Başka kullanıcının hatırlatıcısı tamamlandı'; end if;
 perform set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
 perform public.reset_user_finance_data();
 if exists(select 1 from public.account_income_labels) or exists(select 1 from public.car_service_completions) then raise exception 'Reset akış çocuklarını temizlemedi'; end if;
end $$;
rollback;
