-- Data Health deterministic batch repair boundary regression.
--
-- Run with: npm run db:test:data-health-safe-repairs
-- Requires the local seeded Supabase database. Every fixture and receipt is
-- transaction-local and rolled back at the end.

begin;

-- The immutable ledgers are projection authority. Authenticated clients may
-- read their own events but may neither hold INSERT nor gain it through RLS.
do $$
begin
  if has_table_privilege('authenticated', 'public.card_ledger', 'INSERT') then
    raise exception 'SECURITY FAIL: authenticated still has card_ledger INSERT';
  end if;

  if has_table_privilege('authenticated', 'public.account_ledger', 'INSERT') then
    raise exception 'SECURITY FAIL: authenticated still has account_ledger INSERT';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('card_ledger', 'account_ledger')
      and cmd in ('INSERT', 'ALL')
  ) then
    raise exception 'SECURITY FAIL: ledger INSERT policy still exists';
  end if;

  if has_function_privilege(
    'anon',
    'public.apply_data_health_safe_repairs(jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'SECURITY FAIL: anon can execute safe-repair RPC';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.apply_data_health_safe_repairs(jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'SECURITY FAIL: authenticated cannot execute safe-repair RPC';
  end if;

  if has_function_privilege(
    'anon',
    'public.update_card_expense_health_metadata(uuid,text,text,timestamptz)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.update_card_expense_health_metadata(uuid,text,text,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'SECURITY FAIL: card-expense metadata RPC grants are invalid';
  end if;

  if has_table_privilege('authenticated', 'public.data_health_repair_runs', 'INSERT')
     or has_table_privilege('authenticated', 'public.data_health_repair_runs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.data_health_repair_runs', 'DELETE')
     or has_table_privilege('authenticated', 'public.data_health_repair_steps', 'INSERT')
     or has_table_privilege('authenticated', 'public.data_health_repair_steps', 'UPDATE')
     or has_table_privilege('authenticated', 'public.data_health_repair_steps', 'DELETE') then
    raise exception 'SECURITY FAIL: authenticated can mutate repair receipts directly';
  end if;
end $$;

-- A second auth subject is needed to exercise both the FK-backed receipt path
-- and cross-user target isolation without relying on a non-existent JWT user.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'data-health-cross@example.test', '',
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}',
  '', '', '', ''
)
on conflict (id) do nothing;

-- Trusted owner fixtures first create honest opening ledger events.
insert into public.cards (
  id, user_id, bank_name, card_name, card_type, credit_limit,
  debt_amount, statement_debt_amount, current_period_spending,
  provision_amount, statement_day, due_day, current_balance
)
values
  (
    'd3100000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'Test', 'DH-CARD-LEDGER', 'kredi_karti', 10000,
    100, 40, 30, 30, 1, 10, 0
  ),
  (
    'd3100000-0000-4000-8000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'Test', 'DH-ACCOUNT-LEDGER', 'banka_karti', 0,
    0, 0, 0, 0, null, null, 250
  ),
  (
    'd3100000-0000-4000-8000-000000000003',
    '11111111-1111-1111-1111-111111111111',
    'Test', 'DH-SPLIT-CLAMP', 'kredi_karti', 10000,
    100, 0, 0, 0, 1, 10, 0
  );

insert into public.loans (
  id, user_id, bank_name, loan_name, total_amount, remaining_amount,
  monthly_payment, installment_day, remaining_installments, status
)
values (
  'd3200000-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Test', 'DH-LOAN-SUMMARY', 100, 100, 70, 10, 2, 'active'
);

insert into public.loan_installments (
  id, user_id, loan_id, installment_no, due_date, amount, status, paid_at
)
values
  (
    'd3210000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'd3200000-0000-4000-8000-000000000001',
    1, current_date, 30, 'ödendi', now()
  ),
  (
    'd3210000-0000-4000-8000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'd3200000-0000-4000-8000-000000000001',
    2, current_date + 30, 70, 'bekliyor', null
  );

-- Model out-of-band projection drift without appending forged authority.
set local app.ledger_suppress = '1';
update public.cards
set debt_amount = 999,
    statement_debt_amount = 500,
    current_period_spending = 300,
    provision_amount = 199
where id = 'd3100000-0000-4000-8000-000000000001';

update public.cards
set current_balance = 999
where id = 'd3100000-0000-4000-8000-000000000002';
set local app.ledger_suppress = '';

update public.loans
set remaining_amount = 999,
    remaining_installments = 9,
    status = 'closed'
where id = 'd3200000-0000-4000-8000-000000000001';

-- The normal trigger makes an invalid split structurally impossible. Disable
-- it only as database owner to model a legacy row that the repair must clamp.
alter table public.cards disable trigger cards_clamp_breakdown;
set local app.ledger_suppress = '1';
update public.cards
set statement_debt_amount = 80,
    current_period_spending = 70,
    provision_amount = 60
where id = 'd3100000-0000-4000-8000-000000000003';
set local app.ledger_suppress = '';
alter table public.cards enable trigger cards_clamp_breakdown;

-- The catalog assertion above proves that anon fails at the EXECUTE grant
-- boundary. An authenticated database role without a subject exercises the
-- second unauthenticated path and must fail before a run row is inserted.
set local request.jwt.claims to '{"role":"authenticated"}';
set local role authenticated;
do $$
declare
  v_denied boolean := false;
  v_state text;
begin
  begin
    perform public.apply_data_health_safe_repairs(
      '[]'::jsonb,
      'd3300000-0000-4000-8000-000000000011'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_denied := v_state = 'P0001';
  end;

  if not v_denied then
    raise exception 'SECURITY FAIL: subject-less authenticated call was not denied';
  end if;
end $$;
reset role;

-- Direct ledger forging must also fail at runtime, not merely in catalog
-- inspection. Trigger-owned opening rows remain readable to their owner.
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

-- Revoking client ledger INSERT must not break honest card/account creation;
-- SECURITY DEFINER trigger ownership still emits the opening authority event.
insert into public.cards (
  id, user_id, bank_name, card_name, card_type, credit_limit,
  debt_amount, statement_debt_amount, current_period_spending,
  provision_amount, statement_day, due_day, current_balance
)
values
  (
    'd3100000-0000-4000-8000-000000000010',
    '11111111-1111-1111-1111-111111111111',
    'Test', 'DH-CLIENT-CARD-CREATE', 'kredi_karti', 1000,
    25, 25, 0, 0, 1, 10, 0
  ),
  (
    'd3100000-0000-4000-8000-000000000011',
    '11111111-1111-1111-1111-111111111111',
    'Test', 'DH-CLIENT-ACCOUNT-CREATE', 'banka_karti', 0,
    0, 0, 0, 0, null, null, 30
  );

do $$
begin
  if (select count(*) from public.card_ledger
      where card_id = 'd3100000-0000-4000-8000-000000000010') <> 1 then
    raise exception 'SECURITY FAIL: authenticated card create lost opening ledger event';
  end if;

  if (select count(*) from public.account_ledger
      where card_id = 'd3100000-0000-4000-8000-000000000011') <> 1 then
    raise exception 'SECURITY FAIL: authenticated account create lost opening ledger event';
  end if;
end $$;

do $$
declare
  v_card_denied boolean := false;
  v_account_denied boolean := false;
  v_state text;
begin
  begin
    insert into public.card_ledger (
      user_id, card_id, kind, amount_kurus, source_table, source_id
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'd3100000-0000-4000-8000-000000000001',
      'adjustment', 999999, 'forged',
      'd3100000-0000-4000-8000-000000000001'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_card_denied := v_state = '42501';
  end;

  begin
    insert into public.account_ledger (
      user_id, card_id, kind, amount_kurus, source_table, source_id
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'd3100000-0000-4000-8000-000000000002',
      'adjustment', 999999, 'forged',
      'd3100000-0000-4000-8000-000000000002'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_account_denied := v_state = '42501';
  end;

  if not v_card_denied or not v_account_denied then
    raise exception 'SECURITY FAIL: direct ledger INSERT card=%, account=%',
      v_card_denied, v_account_denied;
  end if;

  if (select count(*) from public.card_ledger
      where card_id = 'd3100000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'FAIL: owner cannot see honest card opening event';
  end if;

  if (select count(*) from public.account_ledger
      where card_id = 'd3100000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'FAIL: owner cannot see honest account opening event';
  end if;
end $$;

-- The guided Data Health editor updates only user-confirmed metadata. It uses
-- optimistic row versioning and must not append or rewrite ledger authority.
insert into public.card_expenses (
  id, user_id, card_id, spent_at, amount, description, category,
  installment_count, installment_amount, status, posted_at, source,
  created_at, updated_at
)
values (
  'd3400000-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'd3100000-0000-4000-8000-000000000001',
  current_date, 12.34, 'Eski açıklama', ' ', 1, 12.34, 'posted', now(), 'manual',
  '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'
);

do $$
declare
  v_expected timestamptz;
  v_ledger_before integer;
  v_ledger_after integer;
  v_denied boolean := false;
  v_state text;
begin
  select updated_at into v_expected
  from public.card_expenses
  where id = 'd3400000-0000-4000-8000-000000000001';

  select count(*) into v_ledger_before
  from public.card_ledger
  where card_id = 'd3100000-0000-4000-8000-000000000001';

  perform public.update_card_expense_health_metadata(
    'd3400000-0000-4000-8000-000000000001',
    'Market alışverişi',
    'Market',
    v_expected
  );

  if not exists (
    select 1
    from public.card_expenses
    where id = 'd3400000-0000-4000-8000-000000000001'
      and description = 'Market alışverişi'
      and category = 'Market'
      and amount = 12.34
      and installment_count = 1
  ) then
    raise exception 'METADATA FAIL: expected fields were not updated safely';
  end if;

  begin
    perform public.update_card_expense_health_metadata(
      'd3400000-0000-4000-8000-000000000001',
      'Stale rewrite',
      'Market',
      v_expected
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_denied := v_state = 'P0001';
  end;

  if not v_denied then
    raise exception 'METADATA FAIL: stale row version was accepted';
  end if;

  select count(*) into v_ledger_after
  from public.card_ledger
  where card_id = 'd3100000-0000-4000-8000-000000000001';

  if v_ledger_after <> v_ledger_before then
    raise exception 'METADATA FAIL: metadata edit changed ledger row count';
  end if;
end $$;

-- Request-shape/domain constraints are rejected before a persistent run is
-- created. Each call must fail with an explicit application exception, not by
-- accidentally reaching target validation or mutation.
do $$
declare
  v_before integer;
  v_after integer;
  v_denied boolean;
  v_state text;
  v_oversize jsonb;
begin
  select count(*) into v_before from public.data_health_repair_runs;

  v_denied := false;
  begin
    perform public.apply_data_health_safe_repairs(
      '[]'::jsonb,
      'd3300000-0000-4000-8000-000000000020'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_denied := v_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'PREVALIDATION FAIL: empty plan was not rejected explicitly';
  end if;

  v_denied := false;
  begin
    perform public.apply_data_health_safe_repairs(
      jsonb_build_array(
        jsonb_build_object(
          'rule', 'card_ledger_recompute',
          'targetId', 'd3100000-0000-4000-8000-000000000001',
          'expectedUpdatedAt', now()
        ),
        jsonb_build_object(
          'rule', 'card_ledger_recompute',
          'targetId', 'd3100000-0000-4000-8000-000000000001',
          'expectedUpdatedAt', now()
        )
      ),
      'd3300000-0000-4000-8000-000000000021'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_denied := v_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'PREVALIDATION FAIL: duplicate rule/target was not rejected explicitly';
  end if;

  v_denied := false;
  begin
    perform public.apply_data_health_safe_repairs(
      jsonb_build_array(
        jsonb_build_object(
          'rule', 'card_ledger_recompute',
          'targetId', 'd3100000-0000-4000-8000-000000000001',
          'expectedUpdatedAt', now()
        ),
        jsonb_build_object(
          'rule', 'loan_summary_recompute',
          'targetId', 'd3200000-0000-4000-8000-000000000001',
          'expectedUpdatedAt', now()
        )
      ),
      'd3300000-0000-4000-8000-000000000022'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_denied := v_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'PREVALIDATION FAIL: mixed card/loan plan was not rejected explicitly';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'rule', 'card_ledger_recompute',
      'targetId', 'd3100000-0000-4000-8000-000000000001',
      'expectedUpdatedAt', now()
    )
  )
  into v_oversize
  from generate_series(1, 101);

  v_denied := false;
  begin
    perform public.apply_data_health_safe_repairs(
      v_oversize,
      'd3300000-0000-4000-8000-000000000023'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_denied := v_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'PREVALIDATION FAIL: oversized plan was not rejected explicitly';
  end if;

  v_denied := false;
  begin
    perform public.apply_data_health_safe_repairs(
      jsonb_build_array(
        jsonb_build_object(
          'rule', 'card_ledger_recompute',
          'expectedUpdatedAt', now()
        )
      ),
      'd3300000-0000-4000-8000-000000000024'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_denied := v_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'PREVALIDATION FAIL: malformed plan was not rejected explicitly';
  end if;

  select count(*) into v_after from public.data_health_repair_runs;
  if v_after <> v_before then
    raise exception 'PREVALIDATION FAIL: rejected plans created % run rows', v_after - v_before;
  end if;
end $$;

-- One stale member invalidates the card/account plan before Pass 2. Every
-- card-domain projection remains at its deliberately drifted value.
do $$
declare
  v_card_ts timestamptz;
  v_account_ts timestamptz;
  v_plan jsonb;
  v_result jsonb;
  v_run_id uuid;
  v_count integer;
begin
  select updated_at into v_card_ts
  from public.cards where id = 'd3100000-0000-4000-8000-000000000001';
  select updated_at into v_account_ts
  from public.cards where id = 'd3100000-0000-4000-8000-000000000002';
  v_plan := jsonb_build_array(
    jsonb_build_object(
      'rule', 'card_ledger_recompute',
      'targetId', 'd3100000-0000-4000-8000-000000000001',
      'expectedUpdatedAt', v_card_ts
    ),
    jsonb_build_object(
      'rule', 'account_ledger_recompute',
      'targetId', 'd3100000-0000-4000-8000-000000000002',
      'expectedUpdatedAt', v_account_ts
    ),
    jsonb_build_object(
      'rule', 'card_split_clamp',
      'targetId', 'd3100000-0000-4000-8000-000000000003',
      'expectedUpdatedAt', '2000-01-01T00:00:00Z'
    )
  );

  v_result := public.apply_data_health_safe_repairs(
    v_plan,
    'd3300000-0000-4000-8000-000000000001'
  );
  v_run_id := (v_result->>'runId')::uuid;

  if v_result->>'status' <> 'conflict'
     or (v_result->>'planned')::integer <> 3
     or (v_result->>'applied')::integer <> 0
     or (v_result->>'skipped')::integer <> 0
     or (v_result->>'idempotentReplay')::boolean then
    raise exception 'STALE FAIL: unexpected result %', v_result;
  end if;

  if (select debt_amount from public.cards
      where id = 'd3100000-0000-4000-8000-000000000001') <> 999
     or (select current_balance from public.cards
         where id = 'd3100000-0000-4000-8000-000000000002') <> 999
     or (select statement_debt_amount + current_period_spending + provision_amount
         from public.cards
         where id = 'd3100000-0000-4000-8000-000000000003') <> 210 then
    raise exception 'STALE FAIL: at least one target was mutated before full validation';
  end if;

  select count(*) into v_count
  from public.data_health_repair_steps
  where run_id = v_run_id
    and status = 'conflict'
    and before_data is null
    and after_data is null;
  if v_count <> 1 then
    raise exception 'STALE FAIL: expected one conflict receipt, got %', v_count;
  end if;
end $$;

-- The valid card/account batch repairs every card-domain deterministic source
-- and records immutable before/after evidence. Replaying the same logical plan
-- in another order must return the original receipt without a second mutation.
do $$
declare
  v_card_ts timestamptz;
  v_account_ts timestamptz;
  v_clamp_ts timestamptz;
  v_plan jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_run_id uuid;
  v_updated_after timestamptz;
  v_updated_replay timestamptz;
  v_ledger_after integer;
  v_ledger_replay integer;
  v_mismatch_denied boolean := false;
  v_state text;
  v_count integer;
begin
  select updated_at into v_card_ts
  from public.cards where id = 'd3100000-0000-4000-8000-000000000001';
  select updated_at into v_account_ts
  from public.cards where id = 'd3100000-0000-4000-8000-000000000002';
  select updated_at into v_clamp_ts
  from public.cards where id = 'd3100000-0000-4000-8000-000000000003';
  v_plan := jsonb_build_array(
    jsonb_build_object(
      'rule', 'card_ledger_recompute',
      'targetId', 'd3100000-0000-4000-8000-000000000001',
      'expectedUpdatedAt', v_card_ts
    ),
    jsonb_build_object(
      'rule', 'account_ledger_recompute',
      'targetId', 'd3100000-0000-4000-8000-000000000002',
      'expectedUpdatedAt', v_account_ts
    ),
    jsonb_build_object(
      'rule', 'card_split_clamp',
      'targetId', 'd3100000-0000-4000-8000-000000000003',
      'expectedUpdatedAt', v_clamp_ts
    )
  );

  v_result := public.apply_data_health_safe_repairs(
    v_plan,
    'd3300000-0000-4000-8000-000000000002'
  );
  v_run_id := (v_result->>'runId')::uuid;

  if v_result->>'status' <> 'succeeded'
     or (v_result->>'planned')::integer <> 3
     or (v_result->>'applied')::integer <> 3
     or (v_result->>'skipped')::integer <> 0
     or (v_result->>'idempotentReplay')::boolean then
    raise exception 'SUCCESS FAIL: unexpected result %', v_result;
  end if;

  if not exists (
    select 1 from public.cards
    where id = 'd3100000-0000-4000-8000-000000000001'
      and debt_amount = 100
      and statement_debt_amount = 40
      and current_period_spending = 30
      and provision_amount = 30
  ) then
    raise exception 'SUCCESS FAIL: card ledger projection was not restored';
  end if;

  if not exists (
    select 1 from public.cards
    where id = 'd3100000-0000-4000-8000-000000000002'
      and current_balance = 250
  ) then
    raise exception 'SUCCESS FAIL: account ledger projection was not restored';
  end if;

  if not exists (
    select 1 from public.cards
    where id = 'd3100000-0000-4000-8000-000000000003'
      and debt_amount = 100
      and statement_debt_amount = 80
      and provision_amount = 20
      and current_period_spending = 0
  ) then
    raise exception 'SUCCESS FAIL: card split was not clamped';
  end if;

  select count(*) into v_count
  from public.data_health_repair_steps
  where run_id = v_run_id
    and user_id = '11111111-1111-1111-1111-111111111111'
    and status = 'applied'
    and before_data is not null
    and after_data is not null
    and before_data <> after_data;
  if v_count <> 3 then
    raise exception 'AUDIT FAIL: expected three card-domain before/after receipts, got %', v_count;
  end if;

  if not exists (
    select 1 from public.data_health_repair_steps
    where run_id = v_run_id
      and rule = 'card_ledger_recompute'
      and (before_data->>'debt_amount')::numeric = 999
      and (after_data->>'debt_amount')::numeric = 100
  ) or not exists (
    select 1 from public.data_health_repair_steps
    where run_id = v_run_id
      and rule = 'account_ledger_recompute'
      and (before_data->>'current_balance')::numeric = 999
      and (after_data->>'current_balance')::numeric = 250
  ) then
    raise exception 'AUDIT FAIL: rule before/after values are incomplete';
  end if;

  select updated_at into v_updated_after
  from public.cards where id = 'd3100000-0000-4000-8000-000000000001';
  select count(*) into v_ledger_after
  from public.card_ledger
  where card_id in (
    'd3100000-0000-4000-8000-000000000001',
    'd3100000-0000-4000-8000-000000000003'
  );

  v_replay := public.apply_data_health_safe_repairs(
    jsonb_build_array(v_plan->2, v_plan->0, v_plan->1),
    'd3300000-0000-4000-8000-000000000002'
  );

  if v_replay->>'status' <> 'succeeded'
     or not (v_replay->>'idempotentReplay')::boolean
     or v_replay->>'runId' <> v_result->>'runId'
     or (v_replay->>'applied')::integer <> 3 then
    raise exception 'IDEMPOTENCY FAIL: unexpected replay %', v_replay;
  end if;

  select updated_at into v_updated_replay
  from public.cards where id = 'd3100000-0000-4000-8000-000000000001';
  select count(*) into v_ledger_replay
  from public.card_ledger
  where card_id in (
    'd3100000-0000-4000-8000-000000000001',
    'd3100000-0000-4000-8000-000000000003'
  );

  if v_updated_replay is distinct from v_updated_after
     or v_ledger_replay <> v_ledger_after then
    raise exception 'IDEMPOTENCY FAIL: replay mutated target or ledger';
  end if;

  select count(*) into v_count
  from public.data_health_repair_runs
  where idempotency_key = 'd3300000-0000-4000-8000-000000000002';
  if v_count <> 1 then
    raise exception 'IDEMPOTENCY FAIL: expected one run, got %', v_count;
  end if;

  select count(*) into v_count
  from public.data_health_repair_steps
  where run_id = v_run_id;
  if v_count <> 3 then
    raise exception 'IDEMPOTENCY FAIL: replay appended steps, count=%', v_count;
  end if;

  -- A key is bound to its canonical request, not merely to the user/run. A
  -- different valid plan must be rejected and must not append receipts.
  begin
    perform public.apply_data_health_safe_repairs(
      jsonb_build_array(v_plan->0),
      'd3300000-0000-4000-8000-000000000002'
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_mismatch_denied := v_state = 'P0001';
  end;
  if not v_mismatch_denied then
    raise exception 'IDEMPOTENCY FAIL: same key accepted a different plan';
  end if;

  select count(*) into v_count
  from public.data_health_repair_runs
  where idempotency_key = 'd3300000-0000-4000-8000-000000000002';
  if v_count <> 1 then
    raise exception 'IDEMPOTENCY FAIL: mismatched replay changed run count to %', v_count;
  end if;

  select count(*) into v_count
  from public.data_health_repair_steps
  where run_id = v_run_id;
  if v_count <> 3 then
    raise exception 'IDEMPOTENCY FAIL: mismatched replay appended steps, count=%', v_count;
  end if;
end $$;

-- Loan summary repair intentionally runs in a separate transaction boundary
-- from cards/accounts and derives only from the installment plan.
do $$
declare
  v_loan_ts timestamptz;
  v_plan jsonb;
  v_result jsonb;
  v_run_id uuid;
  v_count integer;
begin
  select updated_at into v_loan_ts
  from public.loans where id = 'd3200000-0000-4000-8000-000000000001';

  v_plan := jsonb_build_array(
    jsonb_build_object(
      'rule', 'loan_summary_recompute',
      'targetId', 'd3200000-0000-4000-8000-000000000001',
      'expectedUpdatedAt', v_loan_ts
    )
  );

  v_result := public.apply_data_health_safe_repairs(
    v_plan,
    'd3300000-0000-4000-8000-000000000004'
  );
  v_run_id := (v_result->>'runId')::uuid;

  if v_result->>'status' <> 'succeeded'
     or (v_result->>'planned')::integer <> 1
     or (v_result->>'applied')::integer <> 1
     or (v_result->>'skipped')::integer <> 0
     or (v_result->>'idempotentReplay')::boolean then
    raise exception 'LOAN SUCCESS FAIL: unexpected result %', v_result;
  end if;

  if not exists (
    select 1 from public.loans
    where id = 'd3200000-0000-4000-8000-000000000001'
      and remaining_amount = 70
      and remaining_installments = 1
      and status = 'active'
  ) then
    raise exception 'LOAN SUCCESS FAIL: installment projection was not restored';
  end if;

  select count(*) into v_count
  from public.data_health_repair_steps
  where run_id = v_run_id
    and rule = 'loan_summary_recompute'
    and status = 'applied'
    and (before_data->>'remaining_amount')::numeric = 999
    and (after_data->>'remaining_amount')::numeric = 70;
  if v_count <> 1 then
    raise exception 'LOAN AUDIT FAIL: expected one complete before/after receipt, got %', v_count;
  end if;
end $$;

reset role;

-- A real second authenticated subject receives an own failed receipt but may
-- neither resolve nor observe the first user's target/audit rows.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
set local role authenticated;
do $$
declare
  v_result jsonb;
  v_run_id uuid;
  v_count integer;
  v_metadata_denied boolean := false;
  v_state text;
begin
  begin
    perform public.update_card_expense_health_metadata(
      'd3400000-0000-4000-8000-000000000001',
      'Cross-user rewrite',
      'Market',
      now()
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_metadata_denied := v_state = 'P0001';
  end;

  if not v_metadata_denied then
    raise exception 'CROSS-USER FAIL: metadata rewrite was not denied';
  end if;

  if exists (
    select 1
    from public.card_expenses
    where id = 'd3400000-0000-4000-8000-000000000001'
  ) then
    raise exception 'CROSS-USER FAIL: owner expense became visible';
  end if;

  v_result := public.apply_data_health_safe_repairs(
    jsonb_build_array(
      jsonb_build_object(
        'rule', 'card_ledger_recompute',
        'targetId', 'd3100000-0000-4000-8000-000000000001',
        'expectedUpdatedAt', now()
      )
    ),
    'd3300000-0000-4000-8000-000000000003'
  );
  v_run_id := (v_result->>'runId')::uuid;

  if v_result->>'status' <> 'failed'
     or (v_result->>'applied')::integer <> 0
     or (v_result->>'skipped')::integer <> 0 then
    raise exception 'CROSS-USER FAIL: unexpected result %', v_result;
  end if;

  if (select count(*) from public.cards
      where id = 'd3100000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'CROSS-USER FAIL: owner card became visible';
  end if;

  select count(*) into v_count from public.data_health_repair_runs;
  if v_count <> 1 then
    raise exception 'RLS FAIL: cross user sees % run rows instead of own one', v_count;
  end if;

  select count(*) into v_count
  from public.data_health_repair_steps
  where run_id = v_run_id
    and status = 'failed'
    and before_data is null
    and after_data is null;
  if v_count <> 1 then
    raise exception 'RLS FAIL: cross user failed receipt count=%', v_count;
  end if;

  if exists (
    select 1 from public.data_health_repair_runs
    where idempotency_key in (
      'd3300000-0000-4000-8000-000000000001',
      'd3300000-0000-4000-8000-000000000002',
      'd3300000-0000-4000-8000-000000000004'
    )
  ) then
    raise exception 'RLS FAIL: cross user can see owner repair runs';
  end if;
end $$;

reset role;

-- The owner sees all three own runs and their five own steps, but never the second
-- user's failed receipt or message payload.
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.data_health_repair_runs;
  if v_count <> 3 then
    raise exception 'RLS FAIL: owner sees % run rows instead of own three', v_count;
  end if;

  select count(*) into v_count from public.data_health_repair_steps;
  if v_count <> 5 then
    raise exception 'RLS FAIL: owner sees % step rows instead of own five', v_count;
  end if;

  if exists (
    select 1 from public.data_health_repair_runs
    where idempotency_key = 'd3300000-0000-4000-8000-000000000003'
  ) then
    raise exception 'RLS FAIL: owner can see cross-user repair run';
  end if;

  select count(*) into v_count
  from public.data_health_repair_steps
  where before_data is not null and after_data is not null;
  if v_count <> 4 then
    raise exception 'AUDIT FAIL: owner before/after visibility count=%', v_count;
  end if;
end $$;

reset role;

-- Final owner-level checks prove denied calls forged neither authority nor
-- unauthenticated receipts, and the cross-user call changed no owner target.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.card_ledger
  where source_table = 'forged';
  if v_count <> 0 then
    raise exception 'SECURITY FAIL: forged card ledger rows=%', v_count;
  end if;

  select count(*) into v_count
  from public.account_ledger
  where source_table = 'forged';
  if v_count <> 0 then
    raise exception 'SECURITY FAIL: forged account ledger rows=%', v_count;
  end if;

  select count(*) into v_count from public.data_health_repair_runs;
  if v_count <> 4 then
    raise exception 'SECURITY FAIL: expected only owner/cross-user runs, got %', v_count;
  end if;

  if not exists (
    select 1 from public.cards
    where id = 'd3100000-0000-4000-8000-000000000001'
      and debt_amount = 100
      and statement_debt_amount = 40
      and current_period_spending = 30
      and provision_amount = 30
  ) then
    raise exception 'CROSS-USER FAIL: owner target changed after denied call';
  end if;

  raise notice 'Data Health safe-repair regression OK: grants, isolation, prevalidation, domain plans, request-bound idempotency and audit RLS verified.';
end $$;

rollback;
