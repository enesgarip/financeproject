alter table public.usage_events add column flow_id uuid, add column source text;

alter table public.usage_events
  drop constraint usage_events_allowed_event,
  add constraint usage_events_allowed_event check (
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
      when 'opened' then subject in ('expense', 'transfer', 'car-service', 'purchase', 'payment')
      when 'closed' then subject in ('expense', 'transfer', 'car-service', 'purchase', 'payment')
      when 'attempted' then subject in ('expense', 'transfer', 'reserve', 'car-service', 'payment', 'backup')
      when 'failed' then subject in ('expense', 'transfer', 'reserve', 'car-service', 'payment', 'backup')
      when 'completed' then subject in ('expense', 'transfer', 'reserve', 'car-service', 'purchase', 'payment', 'backup')
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
  ),
  add constraint usage_events_flow check (
    (kind <> 'closed' or flow_id is not null)
    and (flow_id is null or (
      subject in ('expense', 'transfer', 'car-service', 'purchase', 'payment')
      and kind in ('opened', 'attempted', 'failed', 'completed', 'closed')
      and (kind <> 'opened' or source is not null)
    ))
    and (source is null or (
      source in (
        'direct', 'quick-actions', 'bottom-nav', 'discovery', 'accounts', 'vehicle',
        'expense-group', 'wishlist', 'goals', 'purchase', 'overview', 'plan', 'payments',
        'loans', 'people', 'control', 'maintenance'
      )
      and ((kind = 'opened' and flow_id is not null)
        or (kind = 'attempted' and subject in ('reserve', 'backup')))
    ))
  );

create function public.fetch_usage_insights(p_days integer)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with today as (
    select p_days as days, (now() at time zone 'Europe/Istanbul')::date as local_day
    where p_days in (7, 30) and (select auth.uid()) is not null
  ),
  bounds as (
    select
      ((local_day - (days - 1))::timestamp at time zone 'Europe/Istanbul') as start_at,
      ((local_day - (2 * days - 1))::timestamp at time zone 'Europe/Istanbul') as previous_at
    from today
  ),
  events as (
    select e.*, e.created_at >= b.start_at as is_current,
      (e.created_at at time zone 'Europe/Istanbul')::date as local_day
    from public.usage_events e cross join bounds b
    where e.user_id = (select auth.uid()) and e.created_at between b.previous_at and now()
  ),
  counters as (
    select kind, subject, count(*) filter (where is_current) as event_count,
      count(distinct local_day) filter (where is_current) as active_days,
      count(*) filter (where not is_current) as previous_count
    from events where kind <> 'closed' group by kind, subject
  ),
  periods as (
    select period.is_current,
      count(distinct e.local_day) as active_days,
      count(*) filter (where e.kind = 'page') as page_views,
      count(*) filter (where e.kind = 'completed') as completed,
      count(*) filter (where e.kind = 'failed') as failed
    from (values (true), (false)) as period(is_current)
    left join events e on e.is_current = period.is_current and e.kind <> 'closed'
    group by period.is_current
  ),
  flow_sessions as (
    select subject, flow_id,
      count(*) filter (where kind = 'attempted') as attempts,
      bool_or(kind = 'closed') as closed,
      bool_or(kind = 'completed') as completed,
      bool_or(kind = 'failed') as failed
    from events where flow_id is not null
    group by subject, flow_id
    having bool_or(is_current and kind = 'opened')
  ),
  flows as (
    select subject, count(*) as opened, count(*) filter (where attempts > 0) as submitted,
      count(*) filter (where completed) as completed,
      count(*) filter (where closed and attempts = 0 and not completed) as closed_before_submit,
      count(*) filter (where failed and not completed) as failed,
      count(*) filter (where completed and failed and attempts > 1) as recovered
    from flow_sessions group by subject
  ),
  sources as (
    select subject, source, count(*) as event_count from events
    where is_current and source is not null
    group by subject, source
  ),
  sms as (
    select
      count(*) filter (where status = 'success' and sms_type = 'card_expense' and amount is not null) as card_sms,
      count(*) filter (where status = 'success' and sms_type = 'account_movement') as account_sms,
      count(*) filter (where status = 'error') as sms_errors
    from public.sms_log cross join bounds b
    where user_id = (select auth.uid()) and created_at between b.start_at and now()
  ),
  foreign_sms as (
    select count(*) filter (where completed_at between b.start_at and now()) as foreign_completed,
      count(*) filter (where completed_at is null) as foreign_pending,
      count(*) filter (where completed_at is null and created_at <= now() - interval '24 hours') as foreign_pending_over_day
    from public.foreign_card_sms cross join bounds b
    where user_id = (select auth.uid())
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(c)) from counters c), '[]'::jsonb),
    'comparison', (select to_jsonb(p) - 'is_current' from periods p where p.is_current),
    'previous', (select to_jsonb(p) - 'is_current' from periods p where not p.is_current),
    'flows', coalesce((select jsonb_agg(to_jsonb(f)) from flows f), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(s)) from sources s), '[]'::jsonb),
    'automation', (select to_jsonb(s) || to_jsonb(f) from sms s cross join foreign_sms f)
  ) from bounds
$$;

revoke all on function public.fetch_usage_insights(integer) from public, anon, authenticated;
grant execute on function public.fetch_usage_insights(integer) to authenticated;
