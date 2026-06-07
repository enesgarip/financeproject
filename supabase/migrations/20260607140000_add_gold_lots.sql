-- Gold purchase ledger (DCA log). Each row is one buy; the app aggregates lots
-- per type into a managed `assets` row (source = 'gold_ledger') so net worth,
-- dashboard and forecast stay correct via the existing assets read path, while
-- the ledger powers average cost, profit/loss and the accumulation chart.
--
-- purchase_date / unit_price are nullable: a holding whose date or cost is
-- unknown still counts toward quantity but is excluded from cost-basis math.

create table if not exists public.gold_lots (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  purchase_date date,
  gold_type     text        not null check (gold_type in ('gram', 'ceyrek')),
  ayar          integer,
  quantity      numeric(15, 4) not null check (quantity > 0),
  unit_price    numeric(15, 2) check (unit_price >= 0),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.gold_lots enable row level security;

grant select, insert, update, delete on table public.gold_lots to authenticated;

drop policy if exists "gold_lots_select_own" on public.gold_lots;
create policy "gold_lots_select_own"
  on public.gold_lots for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "gold_lots_insert_own" on public.gold_lots;
create policy "gold_lots_insert_own"
  on public.gold_lots for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "gold_lots_update_own" on public.gold_lots;
create policy "gold_lots_update_own"
  on public.gold_lots for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "gold_lots_delete_own" on public.gold_lots;
create policy "gold_lots_delete_own"
  on public.gold_lots for delete
  to authenticated
  using (user_id = (select auth.uid()));

create index if not exists gold_lots_user_date_idx
  on public.gold_lots (user_id, purchase_date);

create trigger gold_lots_updated_at
  before update on public.gold_lots
  for each row execute function public.touch_updated_at();

-- Marker for assets rows that are aggregates derived from the gold ledger.
-- These are managed by the app (goldSync) and should not be hand-edited.
alter table public.assets
  add column if not exists source text;

comment on column public.assets.source is
  'When ''gold_ledger'', this asset row is an aggregate maintained from gold_lots.';

create index if not exists assets_user_source_idx
  on public.assets (user_id, source);
