-- AUTO-05/06/07: cihaz bazlı kalıcı teslim niyeti; belirsiz transport otomatik tekrarlanmaz.
create table private.notification_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  reference_id text not null,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null check (status in ('sending', 'accepted', 'retry', 'unknown', 'discarded')),
  attempt integer not null default 1,
  token uuid not null unique default gen_random_uuid(),
  lease_until timestamptz not null default now() + interval '2 minutes',
  next_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, notification_type, reference_id, subscription_id)
);
revoke all on private.notification_deliveries from public, anon, authenticated;

create function public.claim_notification_delivery(p_user_id uuid, p_type text, p_reference text, p_subscription_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row private.notification_deliveries%rowtype; v_prefs jsonb; v_flag text;
  v_hour integer := extract(hour from now() at time zone 'Europe/Istanbul');
  v_start integer; v_end integer;
begin
  if not exists(select 1 from public.push_subscriptions where id=p_subscription_id and user_id=p_user_id) then return null; end if;
  -- Yavaş aday okuması/retry sırasında değişen kullanıcı tercihini gönderimden önce tekrar oku.
  select to_jsonb(p) into v_prefs from public.notification_preferences p where user_id=p_user_id;
  v_flag := case
    when p_type='payment_due_tomorrow' then 'payments_enabled'
    when p_type='loan_installment_due_tomorrow' then 'loans_enabled'
    when p_type in ('card_statement_cut_3d','card_statement_cut_receipt') then 'statements_enabled'
    when p_type in ('weekly_summary','reconciliation_stale_weekly') then 'weekly_enabled'
    when p_type='car_reminder_due_7d' then 'cars_enabled'
    when p_type in ('provision_installment_pending','provision_statement_cut_risk') then 'provisions_enabled'
    when p_type='goal_contribution_due' then 'goals_enabled'
    when p_type='sms_failure_daily' then 'sms_alerts_enabled' end;
  if (v_prefs->>v_flag)::boolean is false then return null; end if;
  v_start := (v_prefs->>'quiet_hours_start')::integer; v_end := (v_prefs->>'quiet_hours_end')::integer;
  if v_start<>v_end and ((v_start<v_end and v_hour>=v_start and v_hour<v_end) or (v_start>v_end and (v_hour>=v_start or v_hour<v_end))) then return null; end if;
  -- Geçiş öncesindeki başarılı user-log'u yeniden gönderme. Yeni akışta tekillik cihazdadır.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_type || ':' || p_reference, 10813));
  if exists(select 1 from public.notification_log where user_id=p_user_id and notification_type=p_type and reference_id=p_reference)
    and not exists(select 1 from private.notification_deliveries where user_id=p_user_id and notification_type=p_type and reference_id=p_reference) then return null; end if;
  select * into v_row from private.notification_deliveries
    where user_id=p_user_id and notification_type=p_type and reference_id=p_reference and subscription_id=p_subscription_id for update;
  if found then
    if v_row.status='sending' and v_row.lease_until <= now() then
      update private.notification_deliveries set status='unknown', updated_at=now()
        where user_id=p_user_id and notification_type=p_type and reference_id=p_reference and subscription_id=p_subscription_id;
      return null; -- Crash/timeout: push kabul edilmiş olabilir. Kör retry yok.
    end if;
    if v_row.status <> 'retry' or v_row.next_attempt_at > now() or v_row.attempt >= 8 then return null; end if;
    update private.notification_deliveries set status='sending', attempt=attempt+1, token=gen_random_uuid(),
      lease_until=now()+interval '2 minutes', updated_at=now()
      where user_id=p_user_id and notification_type=p_type and reference_id=p_reference and subscription_id=p_subscription_id returning * into v_row;
  else
    insert into private.notification_deliveries(user_id,notification_type,reference_id,subscription_id,status)
      values(p_user_id,p_type,p_reference,p_subscription_id,'sending') returning * into v_row;
  end if;
  return jsonb_build_object('token',v_row.token);
end $$;
revoke all on function public.claim_notification_delivery(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_notification_delivery(uuid,text,text,uuid) to service_role;

create function public.finish_notification_delivery(p_token uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row private.notification_deliveries%rowtype;
begin
  if p_status not in ('accepted','retry','unknown','discarded') then raise exception 'Gecersiz teslim sonucu.'; end if;
  update private.notification_deliveries set status=p_status, updated_at=now(),
    next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,attempt)::integer))
    where token=p_token and status='sending' returning * into v_row;
  if not found then return; end if; -- Aynı sonuç/yanıt tekrarı etkisiz.
  if p_status='accepted' then
    insert into public.notification_log(user_id,notification_type,reference_id)
      values(v_row.user_id,v_row.notification_type,v_row.reference_id) on conflict do nothing;
  end if;
end $$;
revoke all on function public.finish_notification_delivery(uuid,text) from public, anon, authenticated;
grant execute on function public.finish_notification_delivery(uuid,text) to service_role;

-- İşlem ayrıntısı/endpoint/kişi/tutar içermez; kullanıcı yalnız kendi teslim sayaçlarını görür.
create function public.fetch_automation_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_maintenance jsonb;
begin
  if v_user is null then raise exception 'Oturum bulunamadi.'; end if;
  select to_jsonb(h) into v_maintenance from private.automation_health h where kind='card-maintenance';
  return jsonb_build_object('maintenance',v_maintenance,
    'unknown_deliveries',(select count(*) from private.notification_deliveries where user_id=v_user and (status='unknown' or (status='sending' and lease_until<=now()))),
    'retry_deliveries',(select count(*) from private.notification_deliveries where user_id=v_user and status='retry' and attempt<8),
    'failed_deliveries',(select count(*) from private.notification_deliveries where user_id=v_user and (status='discarded' or (status='retry' and attempt>=8))));
end $$;
revoke all on function public.fetch_automation_health() from public, anon;
grant execute on function public.fetch_automation_health() to authenticated;
