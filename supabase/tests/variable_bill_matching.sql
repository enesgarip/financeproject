-- Faz Abonelik: SQL/TS kural aynası, geçmiş kanıtı, belirsizlik ve finansal etkisizlik.
begin;
set local app.today = '2026-10-15';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  p public.payments%rowtype;
begin
  p.title := 'Su'; p.amount := 385; p.amount_status := 'estimated';
  if not private.payment_matches_expense(p,'BUSKİ BURSA SU 498149',525)
    or private.payment_matches_expense(p,'APPLE.COM/BILL',385)
    or private.payment_matches_expense(p,'SU MARKET',385) then raise exception 'Kurum kontrolü başarısız'; end if;
  p.match_reference := '498149';
  if not private.payment_matches_expense(p,'BUSKI 498149',525)
    or private.payment_matches_expense(p,'BUSKI 4981490',525)
    or private.payment_matches_expense(p,'BUSKI',525) then raise exception 'Referans kontrolü başarısız'; end if;
  p.match_reference := null; p.title := 'Doğalgaz';
  if not private.payment_matches_expense(p,'AKSA BURSA DOĞALGAZ',240)
    or private.payment_matches_expense(p,'KOZA OTOPARK VALE',385) then raise exception 'Doğalgaz kontrolü başarısız'; end if;
  p.title := 'İGDAŞ';
  if private.payment_matches_expense(p,'AKSA DOĞALGAZ',385) then raise exception 'Farklı kurum birleştirildi'; end if;
  p.title := 'Elektrik';
  if not private.payment_matches_expense(p,'ULUDAG ELEKTRİK 988940',188) then raise exception 'Elektrik kontrolü başarısız'; end if;
  p.title := 'Internet';
  if not private.payment_matches_expense(p,'TURKNET',685) then raise exception 'Internet kontrolü başarısız'; end if;
  p.title := 'Su'; p.amount_status := 'exact';
  if private.payment_matches_expense(p,'BUSKI',525) then raise exception 'Kesin tutar gevşetildi'; end if;
  p.title := 'icloud+'; p.match_amount := 169.99;
  if not private.payment_matches_expense(p,'APPLE.COM/BILL',169.99)
    or private.payment_matches_expense(p,'APPLE.COM/BILL',169.98)
    or private.payment_matches_expense(p,'APPLE.COM/BILL',659.99) then raise exception 'Apple ayrımı başarısız'; end if;
  p.title := 'ChatGPT'; p.match_amount := 499.99;
  if not private.payment_matches_expense(p,'APPLE.COM/BILL',499.99)
    or private.payment_matches_expense(p,'APPLE.COM/BILL',169.99) then raise exception 'ChatGPT ayrımı başarısız'; end if;
end $$;

do $$
declare
  u uuid := '11111111-1111-1111-1111-111111111111';
  c uuid;
  foreign_card uuid;
  water uuid;
  electricity uuid;
  cloud uuid;
  gpt uuid;
  gap uuid;
  exact_bill uuid;
  ambiguous_bill uuid;
  end_bill uuid;
  e public.card_expenses%rowtype;
  snapshot_before jsonb;
  snapshot_after jsonb;
  expense_before jsonb;
  ledger_before bigint;
  archive uuid;
begin
  insert into auth.users(id) values ('22222222-2222-2222-2222-222222222222') on conflict do nothing;
  insert into public.cards(user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day)
    values(u,'Test','Fatura','kredi_karti',50000,25,10) returning id into c;
  insert into public.cards(user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day)
    values('22222222-2222-2222-2222-222222222222','Test','Başka kullanıcı','kredi_karti',50000,25,10) returning id into foreign_card;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id)
    values(u,'Su',385,'estimated','2026-09-08','bank_auto','monthly',8,c) returning id into water;
  update public.payments set match_reference = '498149' where id = water;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id)
    values(u,'Elektrik',399.99,'estimated','2026-09-15','bank_auto','monthly',15,c) returning id into electricity;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id,match_amount)
    values(u,'icloud+',129.99,'estimated','2026-10-11','bank_auto','monthly',11,c,169.99) returning id into cloud;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id,match_amount)
    values(u,'ChatGPT',499.99,'estimated','2026-10-08','bank_auto','monthly',8,c,499.99) returning id into gpt;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id)
    values(u,'İGDAŞ',200,'estimated','2026-08-10','bank_auto','monthly',10,c) returning id into gap;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id,match_merchant)
    values(u,'Kesin fatura',385,'exact','2026-10-10','bank_auto','monthly',10,c,'ISKI') returning id into exact_bill;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id)
    values(u,'TURKNET',400,'estimated','2026-10-10','bank_auto','monthly',10,c) returning id into ambiguous_bill;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,recurrence_end_date,auto_source_card_id)
    values(u,'SPOTIFY',99.99,'exact','2026-10-10','bank_auto','monthly',10,'2026-10-10',c) returning id into end_bill;

  -- Gerçek banka kaynakları ve eski kaynak damgası olmayan posted satır desteklenir.
  perform public.add_card_expense(c,525,'BUSKI 498149','2026-09-08',1,'Fatura','posted',u,'statement_import','bill-water-sep');
  perform public.add_card_expense(c,400,'BUSKI 498149','2026-10-07',1,'Fatura','posted',u,'sms','bill-water-oct');
  e := public.add_card_expense(c,352,'ULUDAG ELEKTRIK','2026-09-11',1,'Fatura','posted',u,'statement_import','bill-electric-sep');
  insert into public.card_statement_archives(user_id,card_id,period_year,period_month,statement_date,statement_debt_amount,total_debt_amount,status,paid_at)
    values(u,c,2026,9,'2026-09-25',352,352,'paid','2026-10-01') returning id into archive;
  -- Kontrollü fixture: kesim RPC'sinin kullanıcıya bağlı tahsis kapısı.
  perform set_config('app.card_statement_allocation_user_id',u::text,true);
  update public.card_expenses set statement_archive_id = archive where id = e.id;
  perform set_config('app.card_statement_allocation_user_id','',true);
  perform public.add_card_expense(c,286,'ULUDAG ELEKTRIK','2026-10-12',1,'Fatura','posted',u,'sms','bill-electric-oct');
  perform public.add_card_expense(c,169.99,'APPLE.COM/BILL','2026-10-11',1,'Abonelik','posted',u,'sms','bill-icloud');
  perform public.add_card_expense(c,659.99,'APPLE.COM/BILL','2026-10-11',1,'Abonelik','posted',u,'sms','bill-other-apple');
  perform public.add_card_expense(c,499.99,'APPLE.COM/BILL','2026-10-08',1,'Abonelik','posted',u,'sms','bill-chatgpt');
  perform public.add_card_expense(c,250,'IGDAS','2026-10-10',1,'Fatura','posted',u,'statement_import','bill-gap');
  perform public.add_card_expense(c,525,'ISKI','2026-10-10',1,'Fatura','posted',u,'statement_import','bill-exact');
  perform public.add_card_expense(c,450,'TURKNET','2026-10-10',1,'Fatura','posted',u,'statement_import','bill-ambiguous-a');
  perform public.add_card_expense(c,550,'TURKNET','2026-10-11',1,'Fatura','posted',u,'statement_import','bill-ambiguous-b');
  perform public.add_card_expense(c,99.99,'SPOTIFY','2026-10-10',1,'Abonelik','posted',u,'statement_import','bill-last');
  -- Aynı tutarlı ilgisiz satır ve iptal edilmiş gerçek satır kanıt değildir.
  perform public.add_card_expense(c,385,'APPLE.COM/BILL','2026-10-08',1,'Abonelik','posted',u,'statement_import','bill-wrong');
  insert into public.card_expenses(user_id,card_id,amount,description,spent_at,status,installment_count,installment_amount,source)
    values(u,c,350,'BUSKI','2026-10-08','cancelled',1,350,'sms');
  select jsonb_agg(to_jsonb(x) order by id) into snapshot_before from public.cards x;
  select jsonb_agg(to_jsonb(x) order by id) into expense_before from public.card_expenses x;
  select count(*) into ledger_before from public.card_ledger;
  if public.reconcile_card_payment_expenses() <> 7 then raise exception 'Beklenen 7 güvenli dönem eşleşmedi'; end if;
  if public.reconcile_card_payment_expenses() <> 0 then raise exception 'Retry planı tekrar ilerletti'; end if;
  select jsonb_agg(to_jsonb(x) order by id) into snapshot_after from public.cards x;
  if snapshot_before is distinct from snapshot_after or ledger_before <> (select count(*) from public.card_ledger)
    or expense_before is distinct from (select jsonb_agg(to_jsonb(x) order by id) from public.card_expenses x)
    then raise exception 'Geçmiş eşleştirmesi finansal veriyi değiştirdi'; end if;
  if (select due_date from public.payments where id = water) <> date '2026-11-08'
    or (select amount from public.payments where id = water) <> 400
    or (select amount_status from public.payments where id = water) <> 'estimated'
    or (select due_date from public.payments where id = electricity) <> date '2026-11-15'
    or (select due_date from public.payments where id = cloud) <> date '2026-11-11'
    or (select amount from public.payments where id = cloud) <> 169.99
    or (select due_date from public.payments where id = gpt) <> date '2026-11-08'
    then raise exception 'Gerçek tutar veya sonraki vade hatalı'; end if;
  if (select due_date from public.payments where id = gap) <> date '2026-08-10'
    or (select due_date from public.payments where id = exact_bill) <> date '2026-10-10'
    or (select due_date from public.payments where id = ambiguous_bill) <> date '2026-10-10'
    or (select status from public.payments where id = end_bill) <> 'ödendi'
    then raise exception 'Boş dönem, kesin tutar, belirsizlik veya bitiş kuralı hatalı'; end if;
  if (select occurred_at::date from public.transaction_history where source_id = water and payment_due_date = '2026-09-08') <> date '2026-09-08'
    then raise exception 'Gerçek banka tarihi korunmadı'; end if;
  -- Başka kullanıcı için public RPC parametre kabul etmez, claims sahibini işler.
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
  if public.reconcile_card_payment_expenses() <> 0 then raise exception 'Başka kullanıcı verisi eşlendi'; end if;
end $$;

-- Bir banka satırı iki benzer plana dağıtılamaz; abone numarası ayrıştırır.
do $$
declare u uuid := '11111111-1111-1111-1111-111111111111'; c uuid;
begin
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
  insert into public.cards(user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day)
    values(u,'Test','İki abonelik','kredi_karti',50000,25,10) returning id into c;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id)
    values(u,'Su',300,'estimated','2026-10-08','bank_auto','monthly',8,c),
          (u,'Su',400,'estimated','2026-10-08','bank_auto','monthly',8,c);
  perform public.add_card_expense(c,525,'BUSKI 123456','2026-10-08',1,'Fatura','posted',u,'sms','two-contracts');
  if private.reconcile_card_payment_expenses(u,c) <> 0 then raise exception 'İki plan arasından tahmin edildi'; end if;
  update public.payments set match_reference = case when amount = 300 then '123456' else '654321' end where auto_source_card_id = c;
  if private.reconcile_card_payment_expenses(u,c) <> 1 then raise exception 'Abone numarası tekilliği sağlamadı'; end if;
end $$;

-- Canlı SMS: değişken tutar, yanlış kurum, retry ve borcun yalnız bir kez yazılması.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
do $$
declare u uuid := '11111111-1111-1111-1111-111111111111'; c uuid; p uuid;
begin
  insert into public.cards(user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day)
    values(u,'Test','SMS değişken','kredi_karti',50000,25,10) returning id into c;
  insert into public.payments(user_id,title,amount,amount_status,due_date,payment_method,recurrence,recurrence_day,auto_source_card_id)
    values(u,'Elektrik',399.99,'estimated','2026-10-15','bank_auto','monthly',15,c) returning id into p;
  perform public.record_sms_card_expense(c,399.99,'APPLE.COM/BILL','2026-10-15 09:00+03','Abonelik',u,'sms-wrong-bill');
  if (select due_date from public.payments where id = p) <> date '2026-10-15' then raise exception 'Aynı tutarlı Apple elektrik sayıldı'; end if;
  perform public.record_sms_card_expense(c,286,'ULUDAG ELEKTRIK','2026-10-15 09:00+03','Fatura',u,'sms-variable-bill');
  perform public.record_sms_card_expense(c,286,'ULUDAG ELEKTRIK','2026-10-15 09:00+03','Fatura',u,'sms-variable-bill');
  if (select due_date from public.payments where id = p) <> date '2026-11-15'
    or (select debt_amount from public.cards where id = c) <> 685.99
    or (select count(*) from public.transaction_history where source_id = p and matched_card_expense_id is not null) <> 1
    then raise exception 'SMS değişken tutar veya idempotensi hatalı'; end if;
end $$;
reset role;

do $$
begin
  if has_function_privilege('anon','public.reconcile_card_payment_expenses()','execute')
    or has_function_privilege('authenticated','private.reconcile_card_payment_expenses(uuid,uuid)','execute')
    or not has_function_privilege('authenticated','public.reconcile_card_payment_expenses()','execute') then raise exception 'RPC yetkileri hatalı'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.reconcile_card_payment_expenses();
    raise exception 'Oturumsuz çağrı kabul edildi';
  exception when raise_exception then
    if sqlerrm <> 'Oturum bulunamadı.' then raise; end if;
  end;
  raise notice 'GECTI: değişken fatura + Apple + geçmiş kanıtı + tekillik + SMS + borç/ledger değişmezliği.';
end $$;
rollback;
