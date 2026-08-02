-- Data Health safe-repair boundary.
--
-- Only deterministic projections/invariants enter this batch RPC. Ambiguous
-- bank truth, payment dates, archived history and structural plan rebuilds stay
-- in guided/manual domain flows.

-- Ledger events are produced by hardened triggers/correction RPCs. The app has
-- no legitimate direct INSERT path, so the aggregate authority must not be
-- forgeable by an authenticated REST client.
drop policy if exists "card_ledger_insert_own" on public.card_ledger;
drop policy if exists "account_ledger_insert_own" on public.account_ledger;
revoke insert on table public.card_ledger from authenticated;
revoke insert on table public.account_ledger from authenticated;

create table if not exists public.data_health_repair_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_plan jsonb not null,
  status text not null check (status in ('running', 'succeeded', 'conflict', 'failed')),
  planned_count integer not null default 0 check (planned_count >= 0),
  applied_count integer not null default 0 check (applied_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);

create table if not exists public.data_health_repair_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.data_health_repair_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rule text not null,
  target_table text not null,
  target_id uuid,
  status text not null check (status in ('applied', 'skipped', 'conflict', 'failed')),
  before_data jsonb,
  after_data jsonb,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists data_health_repair_runs_user_created_idx
  on public.data_health_repair_runs (user_id, created_at desc);
create index if not exists data_health_repair_steps_run_idx
  on public.data_health_repair_steps (run_id, created_at, id);

alter table public.data_health_repair_runs enable row level security;
alter table public.data_health_repair_steps enable row level security;

drop policy if exists "data_health_repair_runs_select_own" on public.data_health_repair_runs;
create policy "data_health_repair_runs_select_own"
  on public.data_health_repair_runs for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "data_health_repair_steps_select_own" on public.data_health_repair_steps;
create policy "data_health_repair_steps_select_own"
  on public.data_health_repair_steps for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.data_health_repair_runs from public, anon, authenticated;
revoke all on table public.data_health_repair_steps from public, anon, authenticated;
grant select on table public.data_health_repair_runs to authenticated;
grant select on table public.data_health_repair_steps to authenticated;

create or replace function public.apply_data_health_safe_repairs(
  p_repairs jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_run_id uuid;
  v_existing public.data_health_repair_runs%rowtype;
  v_repair jsonb;
  v_rule text;
  v_target_id uuid;
  v_expected_updated_at timestamptz;
  v_actual_updated_at timestamptz;
  v_target_table text;
  v_before jsonb;
  v_after jsonb;
  v_projection numeric(14, 2);
  v_remaining_installments integer;
  v_total_installments integer;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_planned integer := 0;
  v_failure text;
  v_failure_status text;
  v_canonical_repairs jsonb;
  v_unique_repairs integer;
  v_has_loan_rule boolean := false;
  v_has_card_rule boolean := false;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_idempotency_key is null then
    raise exception 'İşlem anahtarı zorunludur.';
  end if;

  if p_repairs is null or jsonb_typeof(p_repairs) <> 'array' then
    raise exception 'Düzeltme planı liste olmalıdır.';
  end if;

  v_planned := jsonb_array_length(p_repairs);

  if v_planned < 1 or v_planned > 100 then
    raise exception 'Düzeltme planı 1 ile 100 kayıt arasında olmalıdır.';
  end if;

  -- Reject malformed, unsupported and mixed-domain plans before creating a
  -- persistent audit row. Card/account and loan targets are intentionally not
  -- held in the same transaction: existing payment flows lock loan -> source
  -- card, so a mixed batch would introduce the opposite lock order.
  for v_repair in select value from jsonb_array_elements(p_repairs)
  loop
    if jsonb_typeof(v_repair) <> 'object' then
      raise exception 'Her düzeltme kaydı bir nesne olmalıdır.';
    end if;

    v_rule := nullif(v_repair->>'rule', '');
    v_target_id := nullif(v_repair->>'targetId', '')::uuid;
    v_expected_updated_at := nullif(v_repair->>'expectedUpdatedAt', '')::timestamptz;

    if v_rule is null or v_rule not in (
      'card_ledger_recompute',
      'account_ledger_recompute',
      'loan_summary_recompute',
      'card_split_clamp'
    ) or v_target_id is null or v_expected_updated_at is null then
      raise exception 'Geçersiz veya desteklenmeyen düzeltme kaydı.';
    end if;

    if v_rule = 'loan_summary_recompute' then
      v_has_loan_rule := true;
    else
      v_has_card_rule := true;
    end if;
  end loop;

  if v_has_loan_rule and v_has_card_rule then
    raise exception 'Kart ve kredi düzeltmeleri ayrı atomik planlarda uygulanmalıdır.';
  end if;

  select jsonb_agg(value order by value->>'targetId', value->>'rule'),
         count(distinct (value->>'rule', value->>'targetId'))
  into v_canonical_repairs, v_unique_repairs
  from jsonb_array_elements(p_repairs);

  if v_unique_repairs <> v_planned then
    raise exception 'Aynı kural ve hedef plan içinde tekrarlanamaz.';
  end if;

  -- Linearize repair/reset for this user. This closes the receipt-vs-reset
  -- snapshot race without serializing unrelated users.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 1647595321)
  );

  insert into public.data_health_repair_runs (
    user_id, idempotency_key, request_plan, status, planned_count
  )
  values (v_user_id, p_idempotency_key, v_canonical_repairs, 'running', v_planned)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select *
    into v_existing
    from public.data_health_repair_runs
    where user_id = v_user_id
      and idempotency_key = p_idempotency_key;

    if v_existing.request_plan is distinct from v_canonical_repairs then
      raise exception 'İşlem anahtarı farklı bir düzeltme planıyla yeniden kullanılamaz.';
    end if;

    return jsonb_build_object(
      'runId', v_existing.id,
      'status', v_existing.status,
      'planned', v_existing.planned_count,
      'applied', v_existing.applied_count,
      'skipped', v_existing.skipped_count,
      'message', v_existing.failure_reason,
      'idempotentReplay', true
    );
  end if;

  begin
    -- Pass 1: lock every target in canonical order and validate the complete
    -- snapshot before any financial mutation starts.
    for v_repair in
      select value
      from jsonb_array_elements(p_repairs)
      order by value->>'targetId', value->>'rule'
    loop
      v_rule := nullif(v_repair->>'rule', '');
      v_target_id := nullif(v_repair->>'targetId', '')::uuid;
      v_expected_updated_at := nullif(v_repair->>'expectedUpdatedAt', '')::timestamptz;

      if v_rule is null or v_target_id is null or v_expected_updated_at is null then
        raise exception 'Geçersiz düzeltme planı: rule, targetId ve expectedUpdatedAt zorunludur.';
      end if;

      if v_rule in ('card_ledger_recompute', 'card_split_clamp') then
        select updated_at
        into v_actual_updated_at
        from public.cards
        where id = v_target_id
          and user_id = v_user_id
          and card_type = 'kredi_karti'
        for update;
      elsif v_rule = 'account_ledger_recompute' then
        select updated_at
        into v_actual_updated_at
        from public.cards
        where id = v_target_id
          and user_id = v_user_id
          and card_type = 'banka_karti'
        for update;
      elsif v_rule = 'loan_summary_recompute' then
        select updated_at
        into v_actual_updated_at
        from public.loans
        where id = v_target_id
          and user_id = v_user_id
        for update;
      else
        raise exception 'Desteklenmeyen otomatik düzeltme: %', v_rule;
      end if;

      if not found then
        raise exception 'Hedef kayıt bulunamadı veya kullanıcıya ait değil: %', v_target_id;
      end if;

      if v_actual_updated_at is distinct from v_expected_updated_at then
        raise exception 'STALE: % kaydı kontrol sonrasında değişti.', v_target_id;
      end if;
    end loop;

    -- Pass 2: all preconditions are valid and locks are held. Apply each
    -- deterministic repair and append an immutable step receipt.
    for v_repair in
      select value
      from jsonb_array_elements(p_repairs)
      order by value->>'targetId', value->>'rule'
    loop
      v_rule := v_repair->>'rule';
      v_target_id := (v_repair->>'targetId')::uuid;

      if v_rule = 'card_ledger_recompute' then
        v_target_table := 'cards';
        select jsonb_build_object(
          'debt_amount', debt_amount,
          'statement_debt_amount', statement_debt_amount,
          'current_period_spending', current_period_spending,
          'provision_amount', provision_amount
        )
        into v_before
        from public.cards where id = v_target_id;

        perform public.recompute_card_debt_from_ledger(v_target_id);
        -- Existing recompute RPCs use transaction-local suppression. This batch
        -- may continue with another target, so clear it immediately.
        perform set_config('app.ledger_suppress', '', true);

        select jsonb_build_object(
          'debt_amount', debt_amount,
          'statement_debt_amount', statement_debt_amount,
          'current_period_spending', current_period_spending,
          'provision_amount', provision_amount
        )
        into v_after
        from public.cards where id = v_target_id;
      elsif v_rule = 'account_ledger_recompute' then
        v_target_table := 'cards';
        select jsonb_build_object('current_balance', current_balance)
        into v_before
        from public.cards where id = v_target_id;

        perform public.recompute_account_balance_from_ledger(v_target_id);
        perform set_config('app.ledger_suppress', '', true);

        select jsonb_build_object('current_balance', current_balance)
        into v_after
        from public.cards where id = v_target_id;
      elsif v_rule = 'loan_summary_recompute' then
        v_target_table := 'loans';
        select jsonb_build_object(
          'remaining_amount', remaining_amount,
          'remaining_installments', remaining_installments,
          'status', status
        )
        into v_before
        from public.loans where id = v_target_id;

        select coalesce(sum(amount) filter (where status <> 'ödendi'), 0),
               count(*) filter (where status <> 'ödendi'),
               count(*)
        into v_projection, v_remaining_installments, v_total_installments
        from public.loan_installments
        where loan_id = v_target_id
          and user_id = v_user_id;

        if v_total_installments = 0 then
          raise exception 'Kredi özeti plansız kayıttan otomatik üretilemez.';
        end if;

        update public.loans
        set remaining_amount = v_projection,
            remaining_installments = v_remaining_installments,
            status = case when v_remaining_installments = 0 then 'closed' else 'active' end,
            updated_at = now()
        where id = v_target_id and user_id = v_user_id;

        select jsonb_build_object(
          'remaining_amount', remaining_amount,
          'remaining_installments', remaining_installments,
          'status', status
        )
        into v_after
        from public.loans where id = v_target_id;
      elsif v_rule = 'card_split_clamp' then
        v_target_table := 'cards';
        select jsonb_build_object(
          'debt_amount', debt_amount,
          'statement_debt_amount', statement_debt_amount,
          'current_period_spending', current_period_spending,
          'provision_amount', provision_amount
        )
        into v_before
        from public.cards where id = v_target_id;

        -- The BEFORE trigger owns the exact same priority: statement, then
        -- provision, then current. Rewriting current values invokes that clamp
        -- and emits an auditable reclass event when needed.
        update public.cards
        set statement_debt_amount = statement_debt_amount,
            current_period_spending = current_period_spending,
            provision_amount = provision_amount,
            updated_at = now()
        where id = v_target_id and user_id = v_user_id;

        select jsonb_build_object(
          'debt_amount', debt_amount,
          'statement_debt_amount', statement_debt_amount,
          'current_period_spending', current_period_spending,
          'provision_amount', provision_amount
        )
        into v_after
        from public.cards where id = v_target_id;
      end if;

      if v_before = v_after then
        v_skipped := v_skipped + 1;
        insert into public.data_health_repair_steps (
          run_id, user_id, rule, target_table, target_id, status,
          before_data, after_data, message
        ) values (
          v_run_id, v_user_id, v_rule, v_target_table, v_target_id, 'skipped',
          v_before, v_after, 'Kayıt zaten kaynak gerçekle uyumluydu.'
        );
      else
        v_applied := v_applied + 1;
        insert into public.data_health_repair_steps (
          run_id, user_id, rule, target_table, target_id, status,
          before_data, after_data, message
        ) values (
          v_run_id, v_user_id, v_rule, v_target_table, v_target_id, 'applied',
          v_before, v_after, 'Deterministik sağlık düzeltmesi uygulandı.'
        );
      end if;
    end loop;

    update public.data_health_repair_runs
    set status = 'succeeded',
        applied_count = v_applied,
        skipped_count = v_skipped,
        completed_at = now()
    where id = v_run_id;
  exception when others then
    v_failure := sqlerrm;
    v_failure_status := case when v_failure like 'STALE:%' then 'conflict' else 'failed' end;

    update public.data_health_repair_runs
    set status = v_failure_status,
        failure_reason = v_failure,
        completed_at = now()
    where id = v_run_id;

    insert into public.data_health_repair_steps (
      run_id, user_id, rule, target_table, target_id, status, message
    ) values (
      v_run_id,
      v_user_id,
      coalesce(v_rule, 'batch'),
      coalesce(v_target_table, 'unknown'),
      v_target_id,
      v_failure_status,
      v_failure
    );
  end;

  select * into v_existing
  from public.data_health_repair_runs
  where id = v_run_id;

  return jsonb_build_object(
    'runId', v_existing.id,
    'status', v_existing.status,
    'planned', v_existing.planned_count,
    'applied', v_existing.applied_count,
    'skipped', v_existing.skipped_count,
    'message', v_existing.failure_reason,
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.apply_data_health_safe_repairs(jsonb, uuid) from public;
revoke all on function public.apply_data_health_safe_repairs(jsonb, uuid) from anon;
grant execute on function public.apply_data_health_safe_repairs(jsonb, uuid) to authenticated;

-- User-confirmed metadata repair for the concrete card-expense candidates
-- shown by Data Health. Financial fields are intentionally not accepted.
create or replace function public.update_card_expense_health_metadata(
  p_expense_id uuid,
  p_description text,
  p_category text,
  p_expected_updated_at timestamptz
)
returns public.card_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card_id uuid;
  v_expense public.card_expenses%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_expense_id is null or p_expected_updated_at is null then
    raise exception 'Harcama ve kontrol sürümü zorunludur.';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama açıklaması zorunludur.';
  end if;

  if p_category not in (
    'Market', 'Yemek', 'Ulaşım', 'Alışveriş', 'Fatura', 'Sağlık',
    'Eğlence', 'Eğitim', 'Konut', 'Abonelik', 'İş',
    'Kişisel Bakım', 'Hediye', 'Diğer'
  ) then
    raise exception 'Geçerli bir harcama kategorisi seçilmelidir.';
  end if;

  select card_id
  into v_card_id
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Harcama bulunamadı.';
  end if;

  -- Preserve the canonical card -> expense -> child lock order used by
  -- statement allocation and expense editing.
  perform id
  from public.cards
  where id = v_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
    and card_id = v_card_id
  for update;

  if not found then
    raise exception 'Harcama bulunamadı veya kartı değişti; yeniden deneyin.';
  end if;

  if v_expense.updated_at is distinct from p_expected_updated_at then
    raise exception 'STALE: Harcama kontrol sonrasında değişti.';
  end if;

  if v_expense.status = 'cancelled' then
    raise exception 'İptal edilmiş harcama değiştirilemez.';
  end if;

  update public.card_expenses
  set description = btrim(p_description),
      category = p_category,
      updated_at = now()
  where id = v_expense.id
    and user_id = v_user_id
  returning * into v_expense;

  return v_expense;
end;
$$;

revoke all on function public.update_card_expense_health_metadata(uuid, text, text, timestamptz) from public;
revoke all on function public.update_card_expense_health_metadata(uuid, text, text, timestamptz) from anon;
grant execute on function public.update_card_expense_health_metadata(uuid, text, text, timestamptz) to authenticated;

-- Full user reset also clears repair receipts so restored target IDs cannot
-- inherit stale operational history/idempotency state.
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
