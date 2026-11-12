begin;

insert into auth.users (id, email) values
  ('ea200000-0000-4000-8000-000000000001', 'usage-owner@local.test'),
  ('ea200000-0000-4000-8000-000000000002', 'usage-other@local.test');

insert into public.usage_events (user_id, kind, subject, created_at)
select 'ea200000-0000-4000-8000-000000000001', 'page', '/kartlar',
  (date_trunc('day', now() at time zone 'Europe/Istanbul') - make_interval(days => n))
    at time zone 'Europe/Istanbul'
from unnest(array[6, 7, 30, 91]) as d(n);

insert into public.usage_events (user_id, kind, subject)
values ('ea200000-0000-4000-8000-000000000002', 'tab', 'cards');

do $$
declare prune_sql text;
begin
  if has_function_privilege('anon', 'public.fetch_usage_summary(integer)', 'EXECUTE')
     or has_table_privilege('anon', 'public.usage_events', 'INSERT')
     or has_table_privilege('anon', 'public.usage_events', 'SELECT') then
    raise exception 'Anonim rol kullanım verilerine erişebiliyor';
  end if;
  select command into strict prune_sql from cron.job where jobname = 'prune-usage-events' and active;
  execute prune_sql;
  if (select count(*) from public.usage_events where user_id = 'ea200000-0000-4000-8000-000000000001') <> 3 then
    raise exception '90 günlük temizlik penceresi hatalı';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"ea200000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.usage_events (user_id, kind, subject) values
  ('ea200000-0000-4000-8000-000000000001', 'page', '/kartlar'),
  ('ea200000-0000-4000-8000-000000000001', 'page', '/kartlar'),
  ('ea200000-0000-4000-8000-000000000001', 'completed', 'expense'),
  ('ea200000-0000-4000-8000-000000000001', 'no_results', 'search');

do $$
begin
  if not exists (
    select 1 from public.fetch_usage_summary(7)
    where kind = 'page' and subject = '/kartlar' and event_count = 3 and active_days = 2
  ) or not exists (
    select 1 from public.fetch_usage_summary(30)
    where kind = 'page' and subject = '/kartlar' and event_count = 4 and active_days = 3
  ) then
    raise exception 'İstanbul takvim günleri ve açılış sayıları yanlış';
  end if;
  if exists (select 1 from public.fetch_usage_summary(90)) then
    raise exception 'Desteklenmeyen özet aralığı kabul edildi';
  end if;
  if exists (select 1 from public.fetch_usage_summary(30) where kind = 'tab')
     or exists (select 1 from public.usage_events where kind = 'tab') then
    raise exception 'Başka hesabın kullanım kaydı görüldü';
  end if;
  begin
    insert into public.usage_events (user_id, kind, subject)
    values ('ea200000-0000-4000-8000-000000000002', 'page', '/kartlar');
    raise exception 'Başka hesap adına kullanım kaydı eklendi';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.usage_events (user_id, kind, subject)
    values ('ea200000-0000-4000-8000-000000000001', 'page', '/odemeler/alsam-mi?tutar=1000');
    raise exception 'Ölçümde ham URL kabul edildi';
  exception when check_violation then null; end;
  begin
    insert into public.usage_events (user_id, kind, subject)
    values ('ea200000-0000-4000-8000-000000000001', 'no_results', 'Arama metni');
    raise exception 'Ölçümde arama metni kabul edildi';
  exception when check_violation then null; end;
  begin
    update public.usage_events set subject = '/analiz';
    raise exception 'Kullanım kaydı düzenlenebildi';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
