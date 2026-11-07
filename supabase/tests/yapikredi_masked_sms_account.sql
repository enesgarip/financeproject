-- Gerçek SMS writer RPC: maskeli banka hesabı, ledger/history, retry ve sahiplik.
begin;
insert into auth.users(id,email) values
 ('7a171300-0000-4000-8000-000000000001','ykb-own@local.test'),
 ('7a171300-0000-4000-8000-000000000002','ykb-other@local.test');
insert into public.cards(id,user_id,bank_name,card_name,card_type,account_number,current_balance,account_kind) values
 ('7a171300-0000-4000-8000-000000000011','7a171300-0000-4000-8000-000000000001','Yapı Kredi','LOCAL-E2E-YKB','banka_karti','52123047',85.37,'bank'),
 ('7a171300-0000-4000-8000-000000000012','7a171300-0000-4000-8000-000000000001','DenizBank','LOCAL-E2E-OTHERBANK','banka_karti','52123047',10,'bank'),
 ('7a171300-0000-4000-8000-000000000013','7a171300-0000-4000-8000-000000000002','YAPI KREDI','LOCAL-E2E-OTHERUSER','banka_karti','52123047',20,'bank'),
 ('7a171300-0000-4000-8000-000000000014','7a171300-0000-4000-8000-000000000001','Yapı Kredi','LOCAL-E2E-CASH','banka_karti','52123047',30,'cash');
-- Maske açılarak isim tahmini yapılmamalı; kısaltılmış bir ada bile bağlanmaz.
insert into public.debts(user_id,person_name,direction,value_type,amount,estimated_value_try,status)
values ('7a171300-0000-4000-8000-000000000001','EN GA','borç_verdim','TRY',34820,34820,'açık');

set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
do $$
declare
 v_user uuid := '7a171300-0000-4000-8000-000000000001';
 v_result jsonb;
begin
 -- Owner olmadan iki kullanıcının hesabı arasında tahmin yürütülmez.
 begin
  perform public.record_sms_account_movement('52***047',34820,'in','EN***** GA*****','2026-11-07T15:31:54+03:00','FAST',null,'ykb-ambiguous-user');
  raise exception 'Global maskeli hesap belirsizligi kabul edildi.';
 exception when raise_exception then
  if sqlerrm not like '%birden fazla%' then raise; end if;
 end;
 v_result := public.record_sms_account_movement('52***047',34820,'in','EN***** GA*****','2026-11-07T15:31:54+03:00','FAST',v_user,'ykb-sms-1');
 if v_result->>'id' <> '7a171300-0000-4000-8000-000000000011'
  or (v_result->>'current_balance')::numeric <> 34905.37
  or v_result->'matched_debt' <> 'null'::jsonb then raise exception 'Yanlis hesap, tutar veya maskeli kisi eslemesi.'; end if;
 v_result := public.record_sms_account_movement('52***047',34820,'in','EN***** GA*****','2026-11-07T15:31:54+03:00','FAST',v_user,'ykb-sms-1');
 if v_result->>'replayed' <> 'true' or (v_result->>'current_balance')::numeric <> 34905.37 then raise exception 'Ayni SMS iki kez bakiye yazdi.'; end if;
 begin
  perform public.record_sms_account_movement('***047',1,'in','TEST','2026-11-07T15:31:54+03:00','FAST',v_user,'ykb-short');
  raise exception 'Zayif maske kabul edildi.';
 exception when raise_exception then
  if sqlerrm not like '%Maskeli hesap numarasi gecersiz%' then raise; end if;
 end;
end;
$$;
reset role;
do $$
begin
 if (select count(*) from public.account_ledger where card_id='7a171300-0000-4000-8000-000000000011' and kind='deposit' and amount_kurus=3482000) <> 1 then raise exception 'Ledger delta yanlis veya tekrarlanmis.'; end if;
 if (select count(*) from public.transaction_history where source_event_id='ykb-sms-1' and amount=34820 and occurred_at='2026-11-07T12:31:54Z'::timestamptz) <> 1 then raise exception 'History tutar/zaman/retry yanlis.'; end if;
 if exists(select 1 from public.debts where user_id='7a171300-0000-4000-8000-000000000001' and status<>'açık') then raise exception 'Maskeli ad alacak kapatti.'; end if;
 if exists(select 1 from public.cards where id in ('7a171300-0000-4000-8000-000000000012','7a171300-0000-4000-8000-000000000013','7a171300-0000-4000-8000-000000000014') and current_balance not in (10,20,30)) then raise exception 'Baska banka/kullanici/cash degisti.'; end if;
 -- Uygulamada maskenin kendisi saklanmışsa da tekil eşleşme çalışır.
 update public.cards set account_number='52*****047' where id='7a171300-0000-4000-8000-000000000011';
end;
$$;
set local role service_role;
do $$
begin
 perform public.record_sms_account_movement('52***047',1,'in','TEST','2026-11-07T15:32:54+03:00','FAST','7a171300-0000-4000-8000-000000000001','ykb-mask-stored');
end;
$$;
reset role;
-- Aynı kullanıcıda aynı maskeye uyan ikinci YKB hesabı: hareket reddedilir.
insert into public.cards(user_id,bank_name,card_name,card_type,account_number,current_balance)
values ('7a171300-0000-4000-8000-000000000001','Yapı Kredi','LOCAL-E2E-DUPLICATE','banka_karti','52999047',0);
set local role service_role;
do $$
begin
 begin
  perform public.record_sms_account_movement('52***047',1,'in','TEST','2026-11-07T15:33:54+03:00','FAST','7a171300-0000-4000-8000-000000000001','ykb-ambiguous-account');
  raise exception 'Birden cok hesap kabul edildi.';
 exception when raise_exception then
  if sqlerrm not like '%birden fazla%' then raise; end if;
 end;
end;
$$;
reset role;
do $$
begin
 if exists(select 1 from public.transaction_history where source_event_id in ('ykb-ambiguous-account','ykb-ambiguous-user','ykb-short')) then raise exception 'Reddedilen SMS history yazdi.'; end if;
 if has_function_privilege('authenticated','public.record_sms_account_movement(text,numeric,text,text,timestamptz,text,uuid,text)','execute') then raise exception 'SMS RPC authenticated rolune acik.'; end if;
 raise notice 'GECTI: YKB maskeli hesap + banka/kullanici/cash ayrimi + gecerli saat/tutar + retry + maskeli kisi tahmini yok.';
end;
$$;
rollback;
