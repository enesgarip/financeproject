-- Aylık alışkanlık takibi bilgi amaçlıdır; finans bakiyesi/ledger yazmaz.
create unique index if not exists savings_goals_id_user_unique on public.savings_goals(id, user_id);

create table public.savings_goal_monthly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  goal_id uuid not null,
  effective_month date not null check (effective_month >= '1900-01-01' and extract(day from effective_month) = 1),
  value_type text not null check (value_type in ('TRY', 'gram_altin', 'ceyrek_altin')),
  target_amount numeric(18,6) not null check (target_amount > 0 and target_amount <= 1000000000),
  source text not null check (source in ('gold_buys', 'manual')),
  automatic_from date,
  unique (goal_id, effective_month),
  foreign key (goal_id, user_id) references public.savings_goals(id, user_id) on delete cascade,
  check ((source = 'manual' and automatic_from is null) or
    (source = 'gold_buys' and value_type <> 'TRY' and automatic_from is not null and extract(day from automatic_from) = 1 and automatic_from >= effective_month)),
  check (value_type <> 'TRY' or target_amount = round(target_amount, 2))
);

create table public.savings_goal_monthly_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  goal_id uuid not null,
  month date not null check (month >= '1900-01-01' and extract(day from month) = 1),
  amount numeric(18,6) not null check (amount >= 0 and amount <= 1000000000),
  unique (goal_id, month),
  foreign key (goal_id, user_id) references public.savings_goals(id, user_id) on delete cascade
);

create index savings_goal_monthly_plans_user_idx on public.savings_goal_monthly_plans(user_id);
create index savings_goal_monthly_entries_user_idx on public.savings_goal_monthly_entries(user_id);

alter table public.savings_goal_monthly_plans enable row level security;
alter table public.savings_goal_monthly_entries enable row level security;
create policy "own rows" on public.savings_goal_monthly_plans for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.savings_goal_monthly_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.savings_goal_monthly_plans, public.savings_goal_monthly_entries to authenticated;
create trigger set_monthly_plan_updated_at before update on public.savings_goal_monthly_plans
  for each row execute function public.set_updated_at();
create trigger set_monthly_entry_updated_at before update on public.savings_goal_monthly_entries
  for each row execute function public.set_updated_at();

-- Reset zaten savings_goals'u siler; iki çocuk tablo cascade ile temizlenir.
-- Restore önce eski zinciri çağırır, aynı transaction içinde yeni çocukları ekler.
alter function public.restore_user_finance_data_tx(jsonb) rename to restore_user_finance_data_tx_without_monthly_goals;
revoke all on function public.restore_user_finance_data_tx_without_monthly_goals(jsonb) from public, anon, authenticated;
create function public.restore_user_finance_data_tx(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_table text;
  v_rows jsonb;
  v_result jsonb;
  v_count integer;
begin
  if v_user is null then raise exception 'Oturum bulunamadı.'; end if;
  if coalesce(p_payload->>'schema', '') <> 'financeproject-v2' then
    raise exception 'Tanınmayan yedek şeması.';
  end if;
  if jsonb_typeof(p_payload->'tables') is distinct from 'object' then
    raise exception 'Yedek gövdesi (tables) eksik ya da nesne değil.';
  end if;
  if pg_catalog.pg_column_size(p_payload) > 32 * 1024 * 1024 then
    raise exception 'Yedek dosyası beklenmedik kadar büyük (32 MB sınırı).';
  end if;
  foreach v_table in array array['savings_goal_monthly_plans', 'savings_goal_monthly_entries'] loop
    v_rows := p_payload->'tables'->v_table;
    if v_rows is not null then
      if jsonb_typeof(v_rows) is distinct from 'array' then raise exception 'Aylık hedef satırları liste değil.'; end if;
      if exists (select 1 from jsonb_array_elements(v_rows) r where jsonb_typeof(r) <> 'object') then
        raise exception 'Geçersiz aylık hedef kaydı.';
      end if;
      if exists (select 1 from jsonb_array_elements(v_rows) r, jsonb_object_keys(r) k
        where k <> all (case when v_table = 'savings_goal_monthly_plans'
          then array['id','user_id','created_at','updated_at','goal_id','effective_month','value_type','target_amount','source','automatic_from']
          else array['id','user_id','created_at','updated_at','goal_id','month','amount'] end)) then
        raise exception 'Aylık hedef kaydında tanınmayan kolon var.';
      end if;
    end if;
  end loop;
  v_result := public.restore_user_finance_data_tx_without_monthly_goals(
    jsonb_set(p_payload, '{tables}', (p_payload->'tables') - 'savings_goal_monthly_plans' - 'savings_goal_monthly_entries'));

  insert into public.savings_goal_monthly_plans (id,user_id,created_at,updated_at,goal_id,effective_month,value_type,target_amount,source,automatic_from)
    select coalesce(r.id,gen_random_uuid()),v_user,coalesce(r.created_at,now()),coalesce(r.updated_at,now()),
      r.goal_id,r.effective_month,r.value_type,r.target_amount,r.source,r.automatic_from
    from jsonb_to_recordset(coalesce(p_payload->'tables'->'savings_goal_monthly_plans','[]'::jsonb)) as r(
      id uuid,created_at timestamptz,updated_at timestamptz,goal_id uuid,effective_month date,value_type text,target_amount numeric,source text,automatic_from date);
  get diagnostics v_count = row_count;
  v_result := jsonb_set(v_result,'{tables,savings_goal_monthly_plans}',to_jsonb(v_count),true);

  insert into public.savings_goal_monthly_entries (id,user_id,created_at,updated_at,goal_id,month,amount)
    select coalesce(r.id,gen_random_uuid()),v_user,coalesce(r.created_at,now()),coalesce(r.updated_at,now()),r.goal_id,r.month,r.amount
    from jsonb_to_recordset(coalesce(p_payload->'tables'->'savings_goal_monthly_entries','[]'::jsonb)) as r(
      id uuid,created_at timestamptz,updated_at timestamptz,goal_id uuid,month date,amount numeric);
  get diagnostics v_count = row_count;
  return jsonb_set(v_result,'{tables,savings_goal_monthly_entries}',to_jsonb(v_count),true);
end;
$$;
revoke all on function public.restore_user_finance_data_tx(jsonb) from public, anon;
grant execute on function public.restore_user_finance_data_tx(jsonb) to authenticated;
