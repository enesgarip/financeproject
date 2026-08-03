-- DH-09: Persist "Bu doğru, kapat" decisions per user instead of keeping
-- them only in one browser's localStorage. Financial rows are untouched;
-- acknowledgements are reversible support metadata.

create table if not exists public.data_health_issue_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  issue_id text not null,
  acknowledged_at timestamptz not null default now(),
  constraint data_health_issue_acknowledgements_issue_id_valid check (
    btrim(issue_id) <> '' and octet_length(issue_id) <= 2048
  ),
  constraint data_health_issue_acknowledgements_user_issue_unique unique (user_id, issue_id)
);

create index if not exists data_health_issue_acknowledgements_user_created_idx
  on public.data_health_issue_acknowledgements (user_id, acknowledged_at desc, id);

alter table public.data_health_issue_acknowledgements enable row level security;

drop policy if exists "data_health_issue_acknowledgements_select_own"
  on public.data_health_issue_acknowledgements;
create policy "data_health_issue_acknowledgements_select_own"
  on public.data_health_issue_acknowledgements for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.data_health_issue_acknowledgements from public, anon, authenticated;
grant select on table public.data_health_issue_acknowledgements to authenticated;

create or replace function public.acknowledge_data_health_issues(
  p_issue_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_issue_ids text[];
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select coalesce(array_agg(issue_id order by issue_id), '{}')
  into v_issue_ids
  from (
    select distinct btrim(issue_id) as issue_id
    from unnest(coalesce(p_issue_ids, '{}')) as issue_ids(issue_id)
  ) normalized
  where issue_id <> '';

  if cardinality(v_issue_ids) < 1 or cardinality(v_issue_ids) > 500 then
    raise exception 'Kapatılacak bulgu sayısı 1 ile 500 arasında olmalıdır.';
  end if;

  if exists (
    select 1
    from unnest(v_issue_ids) as issue_ids(issue_id)
    where octet_length(issue_id) > 2048
  ) then
    raise exception 'Bulgu kimliği geçersiz.';
  end if;

  insert into public.data_health_issue_acknowledgements (
    user_id, issue_id, acknowledged_at
  )
  select v_user_id, issue_id, now()
  from unnest(v_issue_ids) as issue_ids(issue_id)
  on conflict (user_id, issue_id) do update
  set acknowledged_at = excluded.acknowledged_at;
end;
$$;

create or replace function public.clear_data_health_issue_acknowledgements()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  delete from public.data_health_issue_acknowledgements
  where user_id = v_user_id;
end;
$$;

revoke all on function public.acknowledge_data_health_issues(text[]) from public;
revoke all on function public.acknowledge_data_health_issues(text[]) from anon;
grant execute on function public.acknowledge_data_health_issues(text[]) to authenticated;

revoke all on function public.clear_data_health_issue_acknowledgements() from public;
revoke all on function public.clear_data_health_issue_acknowledgements() from anon;
grant execute on function public.clear_data_health_issue_acknowledgements() to authenticated;

-- Keep full reset/restore semantics complete: acknowledgements are user-owned
-- support data and must not survive a reset unless replayed from a backup.
create or replace function public.reset_user_finance_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 1647595321)
  );

  perform id
  from public.cards
  where user_id = v_user_id
  order by id
  for update;

  delete from public.data_health_issue_acknowledgements where user_id = v_user_id;
  delete from public.data_health_repair_runs where user_id = v_user_id;
  delete from public.notification_preferences where user_id = v_user_id;
  delete from public.push_subscriptions where user_id = v_user_id;
  delete from public.wishlist_items where user_id = v_user_id;
  delete from public.kasa_buckets where user_id = v_user_id;
  delete from public.dismissed_upcoming_items where user_id = v_user_id;

  perform set_config('app.finance_data_reset_user_id', v_user_id::text, true);
  delete from public.notification_log where user_id = v_user_id;
  delete from public.sms_log where user_id = v_user_id;
  delete from public.account_reconciliations where user_id = v_user_id;
  delete from public.card_installments where user_id = v_user_id;
  delete from public.card_expenses where user_id = v_user_id;
  delete from public.card_statement_archives where user_id = v_user_id;
  delete from public.card_current_settlements where user_id = v_user_id;
  perform set_config('app.finance_data_reset_user_id', '', true);

  delete from public.card_aliases where user_id = v_user_id;
  delete from public.loan_installments where user_id = v_user_id;
  delete from public.savings_goal_components where user_id = v_user_id;
  delete from public.transaction_history where user_id = v_user_id;
  delete from public.payments where user_id = v_user_id;
  delete from public.budgets where user_id = v_user_id;
  delete from public.net_worth_snapshots where user_id = v_user_id;
  delete from public.gold_lots where user_id = v_user_id;
  delete from public.savings_goals where user_id = v_user_id;
  delete from public.salary_history where user_id = v_user_id;
  delete from public.debts where user_id = v_user_id;
  delete from public.loans where user_id = v_user_id;
  delete from public.cards where user_id = v_user_id;
  delete from public.assets where user_id = v_user_id;
end;
$$;

revoke all on function public.reset_user_finance_data() from public;
revoke all on function public.reset_user_finance_data() from anon;
grant execute on function public.reset_user_finance_data() to authenticated;
