alter table public.savings_goals
drop constraint if exists savings_goals_value_type_check;

alter table public.savings_goals
add constraint savings_goals_value_type_check
check (value_type in ('TRY', 'gram_altin', 'ceyrek_altin', 'composite'));

create table if not exists public.savings_goal_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text,
  value_type text not null check (value_type in ('TRY', 'gram_altin', 'ceyrek_altin')),
  target_amount numeric(14, 2) not null default 0 check (target_amount >= 0),
  current_amount numeric(14, 2) not null default 0 check (current_amount >= 0),
  sort_order integer not null default 0
);

create index if not exists savings_goal_components_goal_id_idx on public.savings_goal_components(goal_id);
create index if not exists savings_goal_components_user_id_idx on public.savings_goal_components(user_id);

drop trigger if exists set_savings_goal_components_updated_at on public.savings_goal_components;
create trigger set_savings_goal_components_updated_at
before update on public.savings_goal_components
for each row execute function public.set_updated_at();

alter table public.savings_goal_components enable row level security;

grant select, insert, update, delete on table public.savings_goal_components to authenticated;

drop policy if exists "savings_goal_components_select_own" on public.savings_goal_components;
create policy "savings_goal_components_select_own" on public.savings_goal_components
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "savings_goal_components_insert_own" on public.savings_goal_components;
create policy "savings_goal_components_insert_own" on public.savings_goal_components
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "savings_goal_components_update_own" on public.savings_goal_components;
create policy "savings_goal_components_update_own" on public.savings_goal_components
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "savings_goal_components_delete_own" on public.savings_goal_components;
create policy "savings_goal_components_delete_own" on public.savings_goal_components
for delete to authenticated
using (user_id = (select auth.uid()));
