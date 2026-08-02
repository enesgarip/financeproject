-- Regression: full reset removes July user tables and safely breaks the
-- current-settlement RESTRICT cycle without exposing a settlement write path.
-- Run with: npm run db:test:reset
begin;

-- Build immutable settlement history as the database owner. The authenticated
-- role deliberately has no INSERT path for this table.
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_target uuid := 'a0000000-0000-4000-8000-000000000001';
  v_source uuid := 'a0000000-0000-4000-8000-000000000002';
  v_other_target uuid := 'a0000000-0000-4000-8000-000000000003';
  v_single_settlement uuid := 'a0000000-0000-4000-8000-000000000004';
  v_installment_settlement uuid := 'a0000000-0000-4000-8000-000000000005';
  v_multi_expense uuid := 'a0000000-0000-4000-8000-000000000006';
  v_archive uuid := 'a0000000-0000-4000-8000-000000000012';
begin
  insert into public.cards (
    id, user_id, bank_name, card_name, card_type, credit_limit,
    statement_day, due_day
  )
  values
    (v_target, v_user, 'Test', 'RESET-TARGET', 'kredi_karti', 50000, 25, 10),
    (v_other_target, v_user, 'Test', 'RESET-OTHER', 'kredi_karti', 50000, 25, 10);

  insert into public.cards (
    id, user_id, bank_name, card_name, card_type, current_balance
  )
  values (v_source, v_user, 'Test', 'RESET-SOURCE', 'banka_karti', 50000);

  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount,
    status, paid_at, note
  )
  values (
    v_archive, v_user, v_target, 2002, 2, date '2002-02-01',
    100, 100, 100, 'paid', now(), 'full reset archive fixture'
  );

  insert into public.card_current_settlements (
    id, user_id, card_id, source_card_id, amount, note
  )
  values
    (v_single_settlement, v_user, v_target, v_source, 100, 'reset regression'),
    (v_installment_settlement, v_user, v_target, v_source, 100, 'reset installment regression');

  insert into public.card_expenses (
    id, user_id, card_id, amount, description, installment_count,
    installment_amount, current_settlement_id
  )
  values (
    'a0000000-0000-4000-8000-000000000007', v_user, v_target, 100,
    'Reset single', 1, 100, v_single_settlement
  );

  insert into public.card_expenses (
    id, user_id, card_id, amount, description, installment_count,
    installment_amount, status, posted_at, statement_archive_id
  )
  values (
    'a0000000-0000-4000-8000-000000000013', v_user, v_target, 100,
    'Reset archived single', 1, 100, 'posted', now(), v_archive
  );

  insert into public.card_expenses (
    id, user_id, card_id, amount, description, installment_count,
    installment_amount
  )
  values (
    v_multi_expense, v_user, v_target, 200, 'Reset installment', 2, 100
  );

  insert into public.card_installments (
    id, user_id, card_id, card_expense_id, installment_no,
    installment_count, due_month, amount, description, status, paid_at,
    current_settlement_id
  )
  values (
    'a0000000-0000-4000-8000-000000000008', v_user, v_target,
    v_multi_expense, 1, 2, current_date, 100, 'Reset installment',
    'paid', now(), v_installment_settlement
  );

  insert into public.card_installments (
    id, user_id, card_id, card_expense_id, installment_no,
    installment_count, due_month, amount, description, status, paid_at,
    statement_archive_id
  )
  values (
    'a0000000-0000-4000-8000-000000000014', v_user, v_target,
    v_multi_expense, 2, 2, current_date, 100, 'Reset archived installment',
    'paid', now(), v_archive
  );

  insert into public.notification_log (
    id, user_id, notification_type, reference_id
  )
  values (
    'a0000000-0000-4000-8000-000000000009', v_user,
    'payment_due', 'reset-reference'
  );

  insert into public.sms_log (
    id, user_id, sms_type, status, raw_sms
  )
  values
    (
      'a0000000-0000-4000-8000-000000000010', v_user,
      'unrecognized', 'error', 'owned reset diagnostic'
    ),
    (
      'a0000000-0000-4000-8000-000000000011', null,
      'unrecognized', 'error', 'ownerless service diagnostic'
    );
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_target uuid := 'a0000000-0000-4000-8000-000000000001';
  v_source uuid := 'a0000000-0000-4000-8000-000000000002';
  v_other_target uuid := 'a0000000-0000-4000-8000-000000000003';
  v_single_settlement uuid := 'a0000000-0000-4000-8000-000000000004';
  v_remaining integer;
  v_denied boolean := false;
  v_error_state text;
begin
  if to_regprocedure('public.restore_card_current_settlement(jsonb)') is not null then
    raise exception 'SECURITY FAIL: settlement restore function is exposed';
  end if;

  if to_regprocedure('public.reset_card_data(uuid)') is not null then
    raise exception 'SECURITY FAIL: legacy whole-card reset function is exposed';
  end if;

  begin
    insert into public.card_current_settlements (
      user_id, card_id, source_card_id, amount, note
    )
    values (v_user, v_target, v_source, 100, 'must be denied');
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state in ('42501', 'P0001');
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: direct settlement insert was not denied';
  end if;

  v_denied := false;
  begin
    delete from public.card_current_settlements
    where id = v_single_settlement;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state in ('42501', 'P0001');
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: direct settlement delete was not denied';
  end if;

  -- The child policies reject a real own settlement linked to another card.
  v_denied := false;
  begin
    insert into public.card_expenses (
      user_id, card_id, amount, description, installment_amount,
      current_settlement_id
    )
    values (
      v_user, v_other_target, 50, 'Forged settlement link', 50,
      v_single_settlement
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state in ('42501', 'P0001');
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: forged expense settlement link was not denied';
  end if;

  v_denied := false;
  begin
    insert into public.card_installments (
      user_id, card_id, installment_no, installment_count, due_month,
      amount, description, current_settlement_id
    )
    values (
      v_user, v_other_target, 1, 1, current_date, 50,
      'Forged installment settlement link', v_single_settlement
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state in ('42501', 'P0001');
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: forged installment settlement link was not denied';
  end if;

  insert into public.wishlist_items (user_id, name, estimated_price)
  values (v_user, 'Reset wishlist', 123);

  insert into public.kasa_buckets (user_id, name, reserved_amount)
  values (v_user, 'Reset bucket', 456);

  insert into public.notification_preferences (user_id, weekly_enabled)
  values (v_user, false)
  on conflict (user_id) do update
  set weekly_enabled = excluded.weekly_enabled;

  perform public.reset_user_finance_data();

  select
    (select count(*) from public.cards where user_id = v_user)
    + (select count(*) from public.card_expenses where user_id = v_user)
    + (select count(*) from public.card_installments where user_id = v_user)
    + (select count(*) from public.card_statement_archives where user_id = v_user)
    + (select count(*) from public.card_current_settlements where user_id = v_user)
    + (select count(*) from public.wishlist_items where user_id = v_user)
    + (select count(*) from public.kasa_buckets where user_id = v_user)
    + (select count(*) from public.notification_preferences where user_id = v_user)
    + (select count(*) from public.notification_log where user_id = v_user)
    + (select count(*) from public.sms_log where user_id = v_user)
    + (select count(*) from public.card_ledger where user_id = v_user)
    + (select count(*) from public.account_ledger where user_id = v_user)
  into v_remaining;

  if v_remaining <> 0 then
    raise exception 'RESET FAIL: covered tables still contain % rows', v_remaining;
  end if;

  raise notice 'Reset/security regression OK: settlement cycle removed, writes denied.';
end $$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.sms_log
    where id = 'a0000000-0000-4000-8000-000000000010'
  ) then
    raise exception 'RESET FAIL: owner-bound SMS diagnostic survived';
  end if;

  if not exists (
    select 1
    from public.sms_log
    where id = 'a0000000-0000-4000-8000-000000000011'
      and user_id is null
  ) then
    raise exception 'RESET FAIL: ownerless SMS diagnostic was removed';
  end if;
end $$;

rollback;
