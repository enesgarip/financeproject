-- AUTO-11: GitHub schedule yerine DB cron. Secret deploy'da Vault'a yazılır;
-- migration/cron.job komutunda secret yok, yapılandırılmadan job açılmaz.
create extension if not exists pg_net with schema extensions;
-- pg_net kuyruğu provider rolünce yönetilir. İçine sır yerine kısa ömürlü HMAC gider.

create table private.push_scheduler (
  id boolean primary key default true check(id),
  url text not null,
  apikey text not null,
  last_dispatched_at timestamptz,
  request_id bigint,
  last_response_at timestamptz,
  last_success_at timestamptz,
  last_http_status integer
);
revoke all on private.push_scheduler from public, anon, authenticated;

create function private.dispatch_push_notifications()
returns void language plpgsql security definer set search_path = '' as $$
declare v_config private.push_scheduler%rowtype; v_secret text;
  v_timestamp text := floor(extract(epoch from now()))::bigint::text;
  v_nonce text := gen_random_uuid()::text;
begin
  select * into v_config from private.push_scheduler where id for update;
  if not found then raise exception 'Push zamanlayicisi yapilandirilmadi.'; end if;
  -- Önce önceki async HTTP sonucunu kaydet; cron SQL başarısı teslim başarısı değildir.
  if v_config.request_id is not null then
    update private.push_scheduler s set last_response_at=r.created, last_http_status=coalesce(r.status_code,0),
      last_success_at=case when r.status_code between 200 and 299 then r.created else s.last_success_at end
      from net._http_response r where s.id and r.id=v_config.request_id;
    if not found and v_config.last_dispatched_at < now()-interval '2 minutes' then
      update private.push_scheduler set last_response_at=now(),last_http_status=0 where id;
    end if;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='finance_push_cron_secret';
  if v_secret is null then raise exception 'Push zamanlayici sirri bulunamadi.'; end if;
  update private.push_scheduler set last_dispatched_at=now(), request_id=net.http_post(
    url:=v_config.url, headers:=jsonb_build_object('Content-Type','application/json','apikey',v_config.apikey,
      'x-cron-timestamp',v_timestamp,'x-cron-nonce',v_nonce,
      'x-cron-signature',encode(extensions.hmac(v_timestamp||':'||v_nonce,v_secret,'sha256'),'hex')),
    body:='{"mode":"scheduled"}'::jsonb, timeout_milliseconds:=60000
  ) where id;
end $$;
revoke all on function private.dispatch_push_notifications() from public, anon, authenticated, service_role;

create function public.configure_push_scheduler(p_url text, p_apikey text, p_secret text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid;
begin
  if p_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/push-notify$' or length(p_secret)<16 or length(p_apikey)<16 then
    raise exception 'Gecersiz push zamanlayici ayari.';
  end if;
  perform pg_advisory_xact_lock(681731110);
  select id into v_secret_id from vault.secrets where name='finance_push_cron_secret';
  if v_secret_id is null then perform vault.create_secret(p_secret,'finance_push_cron_secret');
  else perform vault.update_secret(v_secret_id,p_secret); end if;
  insert into private.push_scheduler(id,url,apikey) values(true,p_url,p_apikey)
    on conflict(id) do update set url=excluded.url, apikey=excluded.apikey;
  perform cron.schedule('push-notify-quarter-hourly','*/15 * * * *','select private.dispatch_push_notifications()');
  return true;
end $$;
revoke all on function public.configure_push_scheduler(text,text,text) from public, anon, authenticated, service_role;

create or replace function public.fetch_automation_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_maintenance jsonb; v_scheduler jsonb;
begin
  if v_user is null then raise exception 'Oturum bulunamadi.'; end if;
  select to_jsonb(h) into v_maintenance from private.automation_health h where kind='card-maintenance';
  select jsonb_build_object('last_dispatched_at',last_dispatched_at,'last_response_at',last_response_at,
    'last_http_status',last_http_status,'last_success_at',last_success_at,'stale',last_dispatched_at < now()-interval '30 minutes') into v_scheduler from private.push_scheduler where id;
  return jsonb_build_object('maintenance',v_maintenance,'scheduler',v_scheduler,
    'unknown_deliveries',(select count(*) from private.notification_deliveries where user_id=v_user and (status='unknown' or (status='sending' and lease_until<=now()))),
    'retry_deliveries',(select count(*) from private.notification_deliveries where user_id=v_user and status='retry' and attempt<8),
    'failed_deliveries',(select count(*) from private.notification_deliveries where user_id=v_user and (status='discarded' or (status='retry' and attempt>=8))));
end $$;
