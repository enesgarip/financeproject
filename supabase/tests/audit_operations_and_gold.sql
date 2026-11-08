begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
declare
 u uuid:=auth.uid(); bank uuid; target uuid; asset uuid; bucket uuid; req uuid; args jsonb;
 before_balance numeric; event_count bigint; buy uuid; sell uuid; rejected boolean;
begin
 insert into public.cards(user_id,bank_name,card_name,card_type,current_balance) values(u,'Audit','Source','banka_karti',10000) returning id into bank;
 insert into public.cards(user_id,bank_name,card_name,card_type,current_balance) values(u,'Audit','Target','banka_karti',0) returning id into target;
 insert into public.assets(user_id,name,category,amount,unit,estimated_value_try,auto_valued) values(u,'Audit manual','Diğer',1,'adet',1000,false) returning id into asset;
 insert into public.kasa_buckets(user_id,name,reserved_amount) values(u,'Audit reserve',0) returning id into bucket;
 req:=gen_random_uuid(); args:=jsonb_build_object('p_card_id',bank,'p_amount',100,'p_direction','out');
 perform public.submit_finance_operation(req,'record_manual_account_movement',args);
 select count(*) into event_count from public.account_ledger where card_id=bank;
 perform public.submit_finance_operation(req,'record_manual_account_movement',args);
 if (select current_balance from public.cards where id=bank)<>9900 or (select count(*) from public.account_ledger where card_id=bank)<>event_count then raise exception 'manual replay'; end if;
 rejected:=false;
 begin perform public.submit_finance_operation(req,'record_manual_account_movement',args||'{"p_amount":200}'::jsonb); exception when others then rejected:=true; end;
 if not rejected then raise exception 'changed payload accepted'; end if;
 req:=gen_random_uuid(); args:=jsonb_build_object('p_source_card_id',bank,'p_target_card_id',target,'p_amount',400);
 perform public.submit_finance_operation(req,'transfer_between_accounts',args);
 perform public.submit_finance_operation(req,'transfer_between_accounts',args);
 if (select current_balance from public.cards where id=target)<>400 then raise exception 'transfer replay'; end if;
 req:=gen_random_uuid(); args:=jsonb_build_object('p_asset_id',asset,'p_account_card_id',bank,'p_direction','buy','p_amount',200,'p_quantity',1);
 perform public.submit_finance_operation(req,'trade_asset_with_account',args);
 select current_balance into before_balance from public.cards where id=bank;
 perform public.submit_finance_operation(req,'trade_asset_with_account',args);
 if (select current_balance from public.cards where id=bank)<>before_balance then raise exception 'trade replay'; end if;
 req:=gen_random_uuid(); args:=jsonb_build_object('p_asset_id',asset,'p_value',1400,'p_contribution',200,'p_occurred_at',now());
 perform public.submit_finance_operation(req,'update_asset_value',args);
 select count(*) into event_count from public.asset_value_events where asset_id=asset;
 perform public.submit_finance_operation(req,'update_asset_value',args);
 if (select count(*) from public.asset_value_events where asset_id=asset)<>event_count then raise exception 'value replay'; end if;
 req:=gen_random_uuid(); args:=jsonb_build_object('p_bucket_id',bucket,'p_amount',100);
 perform public.submit_finance_operation(req,'contribute_to_goal_bucket',args);
 perform public.submit_finance_operation(req,'contribute_to_goal_bucket',args);
 if (select reserved_amount from public.kasa_buckets where id=bucket)<>100 then raise exception 'reserve replay'; end if;
 perform public.submit_finance_operation(gen_random_uuid(),'contribute_to_goal_bucket',args);
 if (select reserved_amount from public.kasa_buckets where id=bucket)<>200 then raise exception 'new deliberate contribution'; end if;
 -- Kesin reddin makbuzu yazılmaz; düzeltme sonrası aynı kimlik kullanılabilir.
 req:=gen_random_uuid(); args:=jsonb_build_object('p_card_id',bank,'p_amount',999999,'p_direction','out');
 begin perform public.submit_finance_operation(req,'record_manual_account_movement',args); exception when others then null; end;
 perform public.submit_finance_operation(req,'record_manual_account_movement',jsonb_build_object('p_card_id',bank,'p_amount',1,'p_direction','out'));
 -- 4 haneli miktar özet varlıkta yuvarlanmaz.
 insert into public.assets(user_id,name,category,amount,unit,estimated_value_try) values(u,'Audit gram','Altın',1.2345,'gram',100);
 if (select amount from public.assets where user_id=u and name='Audit gram')<>1.2345 then raise exception 'gold precision'; end if;
 insert into public.gold_lots(user_id,purchase_date,gold_type,direction,quantity) values(u,'2026-01-01','gram','buy',2) returning id into buy;
 insert into public.gold_lots(user_id,purchase_date,gold_type,direction,quantity) values(u,'2026-01-02','gram','sell',1.2345) returning id into sell;
 set constraints check_gold_inventory immediate;
 rejected:=false;
 begin delete from public.gold_lots where id=buy; exception when others then rejected:=true; end;
 if not rejected then raise exception 'buy delete invalidates later sale'; end if;
 rejected:=false;
 begin update public.gold_lots set purchase_date='2025-12-01' where id=sell; exception when others then rejected:=true; end;
 if not rejected then raise exception 'sale before inventory'; end if;
 set constraints check_gold_inventory deferred;
 -- Geçerli toplu geri yüklemede satış önce yazılabilir.
 delete from public.gold_lots where id in (buy,sell);
 insert into public.gold_lots(user_id,purchase_date,gold_type,direction,quantity) values(u,'2026-01-02','gram','sell',1.2345);
 insert into public.gold_lots(user_id,purchase_date,gold_type,direction,quantity) values(u,'2026-01-01','gram','buy',2);
 set constraints check_gold_inventory immediate;
 -- Restore makbuzu resetten sağ çıkar; retry sonradan girilen yeni kaydı silmez.
 req:=gen_random_uuid(); args:='{"p_payload":{"schema":"financeproject-v2","tables":{}}}'::jsonb;
 perform public.submit_finance_operation(req,'restore_user_finance_data_tx',args);
 insert into public.cards(user_id,bank_name,card_name,card_type,current_balance) values(u,'Audit','After restore','banka_karti',123) returning id into bank;
 perform public.submit_finance_operation(req,'restore_user_finance_data_tx',args);
 if not exists(select 1 from public.cards where id=bank and current_balance=123) then raise exception 'restore replay deleted newer write'; end if;
 raise notice 'GECTI: altı işlem yolu için makbuz, yeni niyet, kesin hata, altın hassasiyet ve kronolojik stok';
end $$;
rollback;
