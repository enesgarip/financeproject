create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null,
  subject text not null,
  constraint usage_events_allowed_event check (
    case kind
      when 'page' then subject in (
        '/', '/kartlar', '/varliklar', '/varliklar/maas', '/varliklar/altin',
        '/varliklar/borsa', '/varliklar/araclar', '/borclar/krediler', '/borclar/kisiler',
        '/odemeler', '/odemeler/hedefler', '/odemeler/alsam-mi', '/odemeler/liste',
        '/odemeler/baglamlar', '/analiz', '/analiz/detay', '/analiz/asistan',
        '/veri-sagligi', '/veri-sagligi/islemler'
      )
      when 'tab' then subject in (
        'accounts', 'cards', 'card-period', 'card-installments', 'card-statements',
        'card-pending', 'card-categories', 'payment-due', 'payment-plans'
      )
      when 'opened' then subject in ('expense', 'transfer', 'car-service', 'purchase')
      when 'attempted' then subject in ('expense', 'transfer', 'reserve', 'car-service', 'backup')
      when 'failed' then subject in ('expense', 'transfer', 'reserve', 'car-service', 'backup')
      when 'completed' then subject in ('expense', 'transfer', 'reserve', 'car-service', 'purchase', 'backup')
      when 'discovery' then subject in (
        'overview', 'accounts', 'cards', 'foreign-sms', 'expense', 'transfer', 'card-cycle',
        'assets', 'gold', 'stocks', 'salary', 'cars', 'loans', 'people', 'payments',
        'payment-plans', 'budget', 'goals', 'monthly-goals', 'reserves', 'purchase',
        'wishlist', 'contexts', 'monthly-report', 'month-close', 'categories',
        'subscriptions', 'history', 'record-search', 'credit-score', 'inflation',
        'year-report', 'zakat', 'assistant', 'data-health', 'backup', 'notifications',
        'sms', 'client-errors'
      )
      when 'no_results' then subject = 'search'
      else false
    end
  )
);

create index usage_events_user_created_idx on public.usage_events (user_id, created_at);
alter table public.usage_events enable row level security;
create policy "own usage select" on public.usage_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own usage insert" on public.usage_events
  for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.usage_events from public, anon, authenticated;
grant select, insert on public.usage_events to authenticated;

create function public.fetch_usage_summary(p_days integer)
returns table(kind text, subject text, event_count integer, active_days integer)
language sql stable security invoker set search_path = ''
as $$
  select e.kind, e.subject, count(*)::integer,
    count(distinct (e.created_at at time zone 'Europe/Istanbul')::date)::integer
  from public.usage_events e
  where e.user_id = (select auth.uid())
    and p_days in (7, 30)
    and e.created_at >= (((now() at time zone 'Europe/Istanbul')::date - (p_days - 1))::timestamp
      at time zone 'Europe/Istanbul')
    and e.created_at <= now()
  group by e.kind, e.subject
$$;

revoke all on function public.fetch_usage_summary(integer) from public, anon, authenticated;
grant execute on function public.fetch_usage_summary(integer) to authenticated;

select cron.schedule(
  'prune-usage-events', '41 2 * * *',
  $$delete from public.usage_events where created_at < now() - interval '90 days'$$
);
