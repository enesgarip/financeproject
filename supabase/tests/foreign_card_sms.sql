begin;
insert into auth.users(id,email) values ('7a190000-0000-4000-8000-000000000001','foreign-own@local.test'),('7a190000-0000-4000-8000-000000000002','foreign-other@local.test');
insert into public.cards(id,user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day) values
 ('7a190000-0000-4000-8000-000000000011','7a190000-0000-4000-8000-000000000001','DenizBank','USD test','kredi_karti',100000,25,10),
 ('7a190000-0000-4000-8000-000000000012','7a190000-0000-4000-8000-000000000002','DenizBank','Other','kredi_karti',100000,25,10);
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a190000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
 v_user uuid:='7a190000-0000-4000-8000-000000000001'; v_card uuid:='7a190000-0000-4000-8000-000000000011';
 v_id uuid; v_retry uuid; v_before jsonb; v_payload jsonb; v_report jsonb; v_events integer;
begin
 v_before:=public.fetch_finance_snapshot(now()-interval '24 months',(current_date-interval '24 months')::date,120);
 v_id:=public.queue_foreign_card_sms(v_user,v_card,59.99,'USD','STEAMGAMES.COM 4259522',now(),'Diğer','foreign-event','  BANK USD SMS  ');
 v_retry:=public.queue_foreign_card_sms(v_user,v_card,59.99,'USD','STEAMGAMES.COM 4259522',now(),'Diğer','different-caller-event',E'\nBANK\nUSD  SMS\n');
 if v_retry<>v_id or (select count(*) from public.foreign_card_sms)<>1 then raise exception 'SMS normalize tekrar tekilleşmedi.'; end if;
 if public.fetch_finance_snapshot(now()-interval '24 months',(current_date-interval '24 months')::date,120) is distinct from v_before then raise exception 'Bekleyen USD finansal durumu değiştirdi.'; end if;
 begin
  perform public.queue_foreign_card_sms(v_user,v_card,60,'USD','STEAMGAMES.COM 4259522',now(),'Diğer','foreign-event','BANK USD SMS');
  raise exception using errcode='P9999',message='Olay kimliği farklı tutarda kullanıldı.';
 exception when sqlstate 'P0001' then null; end;
 begin
  perform public.queue_foreign_card_sms('7a190000-0000-4000-8000-000000000002','7a190000-0000-4000-8000-000000000012',59.99,'USD','Other',now(),'Diğer','other','Other SMS');
  raise exception using errcode='P9999',message='Başka kullanıcı adına yazıldı.';
 exception when sqlstate 'P0001' then null; end;
 begin
  update public.foreign_card_sms set completed_amount=59.99,completed_at=now() where id=v_id;
  raise exception using errcode='P9999',message='REST doğrudan yazmaya izin verdi.';
 exception when insufficient_privilege then null; end;
 begin
  perform public.complete_foreign_card_sms(v_id,0);
  raise exception using errcode='P9999',message='Sıfır TL kabul edildi.';
 exception when sqlstate 'P0001' then null; end;
 -- Aynı olay kimliği eski, farklı açıklamalı bir harcamaya aitse tamamlanmaz.
 -- Alt transaction fixture'ı sonunda tüm olayları geri alır.
 begin
  perform public.add_card_expense(p_card_id=>v_card,p_amount=>2600.25,p_description=>'Farklı hareket',p_status=>'provision',p_source=>'sms',p_source_event_id=>'foreign-event');
  begin
   perform public.complete_foreign_card_sms(v_id,2600.25);
   raise exception using errcode='P9999',message='Kaynak kimliği farklı açıklamayla tamamlandı.';
  exception when sqlstate 'P0001' then
   if sqlerrm not like 'SMS daha önce farklı%' then raise; end if;
  end;
  raise exception using errcode='P9998',message='Fixture rollback';
 exception when sqlstate 'P9998' then null; end;
 perform public.complete_foreign_card_sms(v_id,2600.25);
 if (select debt_amount from public.cards where id=v_card)<>2600.25 then raise exception 'Kesin TL borca doğru yazılmadı.'; end if;
 if not exists(select 1 from public.card_expenses where card_id=v_card and amount=2600.25 and source='sms' and source_event_id='foreign-event' and status='provision') then raise exception 'SMS provizyonu yanlış.'; end if;
 select count(*) into v_events from public.card_ledger where card_id=v_card;
 perform public.complete_foreign_card_sms(v_id,2600.25);
 if (select count(*) from public.card_ledger where card_id=v_card)<>v_events or (select debt_amount from public.cards where id=v_card)<>2600.25 then raise exception 'Retry ikinci borç üretti.'; end if;
 begin
  perform public.complete_foreign_card_sms(v_id,2700);
  raise exception using errcode='P9999',message='Tamamlanan işlem başka tutarla değişti.';
 exception when sqlstate 'P0001' then null; end;
 perform public.queue_foreign_card_sms(v_user,v_card,1,'GBP','Bekleyen ikinci işlem',now(),'Diğer','foreign-gbp-event','BANK GBP SMS');
 v_payload:=jsonb_build_object('schema','financeproject-v2','tables',jsonb_build_object(
  'cards',(select jsonb_agg(to_jsonb(c)) from public.cards c),
  'card_expenses',(select jsonb_agg(to_jsonb(e)) from public.card_expenses e),
  'foreign_card_sms',(select jsonb_agg(to_jsonb(s)) from public.foreign_card_sms s)));
 v_report:=public.restore_user_finance_data_tx(v_payload);
 if (v_report->'tables'->>'foreign_card_sms')::int<>2 or not exists(select 1 from public.foreign_card_sms where completed_amount=2600.25 and native_amount=59.99 and currency='USD')
  or not exists(select 1 from public.foreign_card_sms where currency='GBP' and completed_at is null) then raise exception 'Restore döviz ve tamamlama makbuzunu korumadı.'; end if;
 perform public.complete_foreign_card_sms(v_id,2600.25);
 if (select count(*) from public.card_expenses where card_id=v_card)<>1 then raise exception 'Restore sonrası retry çift harcama üretti.'; end if;
 begin
  perform public.restore_user_finance_data_tx(jsonb_set(v_payload,'{tables,foreign_card_sms,0,card_id}','"7a190000-0000-4000-8000-000000000012"'::jsonb));
  raise exception 'Başka kullanıcı kartı restore edildi.';
 exception when foreign_key_violation then null; end;
 if (select count(*) from public.foreign_card_sms)<>2 then raise exception 'Restore rollback mevcut kaydı sildi.'; end if;
 perform public.reset_user_finance_data();
 if exists(select 1 from public.foreign_card_sms) then raise exception 'Reset dövizli SMS bıraktı.'; end if;
 raise notice 'GECTI: döviz bekleme finansal etkisizlik, kaynak tekilliği, sahiplik, kesin TL, retry, restore/rollback ve reset.';
end $$;
rollback;
