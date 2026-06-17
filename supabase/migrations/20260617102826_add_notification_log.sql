-- Push notification send log (roadmap Y1).
--
-- The push-notify edge function writes one row per logical notification after
-- a successful delivery attempt. The unique key prevents repeated sends for the
-- same user/type/reference across daily cron retries. `reference_id` is text on
-- purpose: recurring rows use stable DB ids plus the due/statement/week date.

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (length(trim(notification_type)) > 0),
  reference_id text not null check (length(trim(reference_id)) > 0),
  sent_at timestamptz not null default now(),
  unique (user_id, notification_type, reference_id)
);

create index if not exists notification_log_user_sent_idx
  on public.notification_log (user_id, sent_at desc);

alter table public.notification_log enable row level security;

-- Keep the existing Web Push subscription table explicitly exposed for its
-- intended access paths on projects where Supabase no longer applies broad
-- public-schema default grants to new objects.
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select, delete on table public.push_subscriptions to service_role;

grant select on table public.notification_log to authenticated;
grant select, insert, delete on table public.notification_log to service_role;

drop policy if exists "notification_log_select_own" on public.notification_log;
create policy "notification_log_select_own"
  on public.notification_log for select
  to authenticated
  using (user_id = (select auth.uid()));
