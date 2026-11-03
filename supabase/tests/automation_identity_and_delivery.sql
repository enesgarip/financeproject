begin;
insert into public.cards(id,user_id,bank_name,card_name,card_type,account_number,current_balance)
values('ac310000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','Test','SMS identity','banka_karti','99000000-991',1000);
insert into public.debts(user_id,person_name,direction,value_type,amount,estimated_value_try,status)
select '11111111-1111-1111-1111-111111111111',name,'borç_verdim','TRY',500,500,'açık'
from unnest(array['A B','A.B.','A Yılmaz']) as x(name);

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.record_sms_account_movement('99000000-991',100,'in','TAMAMEN FARKLI KISI','2026-11-03T10:00:00+03:00','FAST','11111111-1111-1111-1111-111111111111','auto-identity-1');
select public.record_sms_account_movement('99000000-991',100,'in','TAMAMEN FARKLI KISI','2026-11-03T10:00:00+03:00','FAST','11111111-1111-1111-1111-111111111111','auto-identity-1');
reset role;
do $$ begin
  if exists(select 1 from public.debts where person_name in ('A B','A.B.','A Yılmaz') and user_id='11111111-1111-1111-1111-111111111111' and estimated_value_try<>500) then raise exception 'Baş harf kanıtsız kişiye eşlendi.'; end if;
  if (select current_balance from public.cards where id='ac310000-0000-4000-8000-000000000001')<>1100 then raise exception 'SMS retry bakiyeyi yineledi.'; end if;
end $$;

insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values
('ac310000-0000-4000-8000-000000000011','11111111-1111-1111-1111-111111111111','https://example.test/a','fake','fake'),
('ac310000-0000-4000-8000-000000000012','11111111-1111-1111-1111-111111111111','https://example.test/b','fake','fake');
insert into public.notification_log(user_id,notification_type,reference_id)
select '11111111-1111-1111-1111-111111111111','audit','old-'||n from generate_series(1,1101) as x(n);

do $$ declare a jsonb; b jsonb; c jsonb; begin
  a:=public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','mixed','ac310000-0000-4000-8000-000000000011');
  if a is null then raise exception 'İlk cihaz claim yok.'; end if;
  if public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','mixed','ac310000-0000-4000-8000-000000000011') is not null then raise exception 'Aktif lease ikinci gönderime izin verdi.'; end if;
  perform public.finish_notification_delivery((a->>'token')::uuid,'accepted');
  b:=public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','mixed','ac310000-0000-4000-8000-000000000012');
  if b is null then raise exception 'İlk cihaz başarısı ikinciyi engelledi.'; end if;
  perform public.finish_notification_delivery((b->>'token')::uuid,'retry');
  update private.notification_deliveries set next_attempt_at=now()-interval '1 second' where reference_id='mixed';
  c:=public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','mixed','ac310000-0000-4000-8000-000000000012');
  if c is null or c=b then raise exception 'Başarısız endpoint tekrar claim edilmedi.'; end if;
  if public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','mixed','ac310000-0000-4000-8000-000000000011') is not null then raise exception 'Başarılı cihaz tekrar claim edildi.'; end if;
  perform public.finish_notification_delivery((b->>'token')::uuid,'accepted'); -- Eski worker sonucu yeni lease'i değiştiremez.
  if not exists(select 1 from private.notification_deliveries where token=(c->>'token')::uuid and status='sending') then raise exception 'Eski token yeni lease durumunu değiştirdi.'; end if;
  perform public.finish_notification_delivery((c->>'token')::uuid,'unknown');
  if public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','mixed','ac310000-0000-4000-8000-000000000012') is not null then raise exception 'Belirsiz teslim otomatik tekrarlandı.'; end if;
  -- Eski user log'u 1101 sınırının arkasında olsa da PK sorgusu onu bulur.
  if public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','old-1101','ac310000-0000-4000-8000-000000000011') is not null then raise exception 'Eski log hacim sınırında kayboldu.'; end if;
  a:=public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','lost-response','ac310000-0000-4000-8000-000000000011');
  update private.notification_deliveries set lease_until=now()-interval '1 second' where token=(a->>'token')::uuid;
  if public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','lost-response','ac310000-0000-4000-8000-000000000011') is not null then raise exception 'Kaybolan sonuç kör tekrarlandı.'; end if;
  if not exists(select 1 from private.notification_deliveries where token=(a->>'token')::uuid and status='unknown') then raise exception 'Lease kaybı görünür değil.'; end if;
  if has_function_privilege('authenticated','public.claim_notification_delivery(uuid,text,text,uuid)','EXECUTE') or has_function_privilege('anon','public.finish_notification_delivery(uuid,text)','EXECUTE') then raise exception 'Teslim RPC yetkisi sızdı.'; end if;
  if has_function_privilege('authenticated','public.configure_push_scheduler(text,text,text)','EXECUTE') then raise exception 'Scheduler ayarı kullanıcıya açık.'; end if;
end $$;

-- Zamanlayıcı setup transaction'da; HTTP dispatch edilmez, Vault/cron satırı rollback olur.
insert into public.notification_preferences(user_id,payments_enabled)
values('11111111-1111-1111-1111-111111111111',false)
on conflict(user_id) do update set payments_enabled=false;
do $$ begin
  if public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','payment_due_tomorrow','pref-check','ac310000-0000-4000-8000-000000000011') is not null then raise exception 'Kapalı tercih claim edildi.'; end if;
end $$;
update public.notification_preferences set payments_enabled=true,
  quiet_hours_start=extract(hour from now() at time zone 'Europe/Istanbul'),
  quiet_hours_end=(extract(hour from now() at time zone 'Europe/Istanbul')::integer+23)%24
where user_id='11111111-1111-1111-1111-111111111111';
do $$ begin
  if public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','payment_due_tomorrow','pref-check','ac310000-0000-4000-8000-000000000011') is not null then raise exception 'Sessiz saatte claim edildi.'; end if;
end $$;
update public.notification_preferences set quiet_hours_start=null,quiet_hours_end=null where user_id='11111111-1111-1111-1111-111111111111';
do $$ begin
  if public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','payment_due_tomorrow','pref-check','ac310000-0000-4000-8000-000000000011') is null then raise exception 'Uygun saatte aday claim edilmedi.'; end if;
end $$;
select public.configure_push_scheduler('https://auditproject.supabase.co/functions/v1/push-notify','audit-public-key-123456789','audit-private-cron-key-123456789');
select public.configure_push_scheduler('https://auditproject.supabase.co/functions/v1/push-notify','audit-public-key-123456789','audit-private-cron-key-rotated');
do $$ begin
  if (select count(*) from cron.job where jobname='push-notify-quarter-hourly')<>1 then raise exception 'Scheduler iki kez kuruldu.'; end if;
  if (select schedule from cron.job where jobname='push-notify-quarter-hourly')<>'*/15 * * * *' then raise exception 'Scheduler periyodu yanlış.'; end if;
  if exists(select 1 from cron.job where command like '%audit-private-cron%') then raise exception 'Cron komutunda sır var.'; end if;
  if (select count(*) from vault.secrets where name='finance_push_cron_secret')<>1 then raise exception 'Vault rotasyonu çoğaldı.'; end if;
  perform private.dispatch_push_notifications(); -- Transaction rollback olduğundan ağ isteği gönderilmez.
  if exists(select 1 from net.http_request_queue where headers ? 'x-cron-secret') then raise exception 'HTTP kuyruğunda ham sır var.'; end if;
  if not exists(select 1 from net.http_request_queue where headers ? 'x-cron-signature' and length(headers->>'x-cron-signature')=64) then raise exception 'İmzalı scheduler çağrısı yok.'; end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
set local request.jwt.claims='{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}';
do $$ declare health jsonb; begin
  health:=public.fetch_automation_health();
  if (health->>'unknown_deliveries')::integer<>2 then raise exception 'Belirsiz sonuç sağlık sayacı yanlış: %',health; end if;
end $$;
reset role;
-- Satır/alt aşama istisnası yutulsa da üst sonuç/sağlık hatayı korur.
insert into private.automation_health(kind,ran_at,ok,errors,last_success_at)
values('card-maintenance',now()-interval '1 day',true,0,now()-interval '1 day')
on conflict(kind) do update set last_success_at=excluded.last_success_at;
create or replace function public.post_due_card_installments()
returns integer language plpgsql security definer set search_path='' as $$
begin raise exception 'Sentetik bakım aşaması hatası'; end $$;
do $$ declare result jsonb; begin
  result:=public.run_scheduled_card_maintenance();
  if (result->>'ok')::boolean is distinct from false or (result->>'errors')::integer<1 then raise exception 'Bakım alt hatası başarılı göründü: %',result; end if;
  if not exists(select 1 from private.automation_health where kind='card-maintenance' and not ok and errors>0) then raise exception 'Bakım hata durumu kalıcı değil.'; end if;
  if not exists(select 1 from private.automation_health where kind='card-maintenance' and last_success_at=now()-interval '1 day') then raise exception 'Hata önceki başarı zamanını sildi.'; end if;
end $$;
-- HTTP sonucu yoksa veya timeout'sa yeni cron çağrısı başarı görüntüsü üretmez.
update private.push_scheduler set request_id=-999,last_dispatched_at=now()-interval '1 hour';
select private.dispatch_push_notifications();
do $$ begin
  if (select last_http_status from private.push_scheduler where id)<>0 then raise exception 'Kayıp HTTP sonucu hata olarak izlenmedi.'; end if;
end $$;
rollback;
