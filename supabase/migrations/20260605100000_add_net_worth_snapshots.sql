-- Daily client-driven net-worth snapshot (Option A).
-- The app upserts one row per user per day when AnalysisPage loads,
-- using the valuation already computed on the client (buildFinancialPosition).
-- A later upgrade (Faz 3) can store the gold/FX rate used per snapshot
-- and show inflation-adjusted / foreign-currency views.

create table if not exists public.net_worth_snapshots (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  snapshot_date date        not null,
  net_worth     numeric(15, 2) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

alter table public.net_worth_snapshots enable row level security;

create policy "net_worth_snapshots_select"
  on public.net_worth_snapshots for select
  using (auth.uid() = user_id);

create policy "net_worth_snapshots_insert"
  on public.net_worth_snapshots for insert
  with check (auth.uid() = user_id);

create policy "net_worth_snapshots_update"
  on public.net_worth_snapshots for update
  using (auth.uid() = user_id);

create policy "net_worth_snapshots_delete"
  on public.net_worth_snapshots for delete
  using (auth.uid() = user_id);

-- Keep updated_at in sync automatically.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger net_worth_snapshots_updated_at
  before update on public.net_worth_snapshots
  for each row execute function public.touch_updated_at();
