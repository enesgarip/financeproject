-- Regression: only canonical card RPCs may allocate existing children to an
-- early-current settlement or a statement archive.
-- Run with: npm run db:test:card-allocation
begin;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_pay_card uuid := 'a1000000-0000-4000-8000-000000000001';
  v_cut_card uuid := 'a1000000-0000-4000-8000-000000000002';
  v_forge_card uuid := 'a1000000-0000-4000-8000-000000000003';
  v_source uuid := 'a1000000-0000-4000-8000-000000000004';
  v_old_settlement uuid := 'a1000000-0000-4000-8000-000000000005';
  v_old_archive uuid := 'a1000000-0000-4000-8000-000000000006';
begin
  insert into public.cards (
    id, user_id, bank_name, card_name, card_type, credit_limit,
    statement_day, due_day
  )
  values
    (v_pay_card, v_user, 'Test', 'ALLOC-PAY', 'kredi_karti', 50000, 1, 10),
    -- NULL makes cut_card_statement use current_date as its deterministic
    -- boundary; a fixed day can cross into the previous cycle on month day 1.
    (v_cut_card, v_user, 'Test', 'ALLOC-CUT', 'kredi_karti', 50000, null, 10),
    (v_forge_card, v_user, 'Test', 'ALLOC-FORGE', 'kredi_karti', 50000, 1, 10);

  insert into public.cards (
    id, user_id, bank_name, card_name, card_type, current_balance
  )
  values (v_source, v_user, 'Test', 'ALLOC-SOURCE', 'banka_karti', 1000);

  -- Trusted database-owner fixtures model immutable historical parents. The
  -- application roles cannot insert either parent directly.
  insert into public.card_current_settlements (
    id, user_id, card_id, source_card_id, amount, note
  )
  values (
    v_old_settlement, v_user, v_forge_card, v_source, 10,
    'allocation security fixture'
  );

  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount, note
  )
  values (
    v_old_archive, v_user, v_forge_card, 2001, 1, date '2001-01-01',
    10, 10, 10, 'allocation security fixture'
  );
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_pay_card uuid := 'a1000000-0000-4000-8000-000000000001';
  v_cut_card uuid := 'a1000000-0000-4000-8000-000000000002';
  v_forge_card uuid := 'a1000000-0000-4000-8000-000000000003';
  v_source uuid := 'a1000000-0000-4000-8000-000000000004';
  v_old_settlement uuid := 'a1000000-0000-4000-8000-000000000005';
  v_old_archive uuid := 'a1000000-0000-4000-8000-000000000006';
  v_expense_current uuid := 'a1000000-0000-4000-8000-000000000007';
  v_expense_archive uuid := 'a1000000-0000-4000-8000-000000000008';
  v_installment_current uuid := 'a1000000-0000-4000-8000-000000000009';
  v_installment_archive uuid := 'a1000000-0000-4000-8000-000000000010';
  v_delete_expense uuid := 'a1000000-0000-4000-8000-000000000011';
  v_archive_insert_expense uuid := 'a1000000-0000-4000-8000-000000000012';
  v_archive_insert_installment uuid := 'a1000000-0000-4000-8000-000000000013';
  v_denied boolean;
  v_error_state text;
  v_balance numeric;
  v_debt numeric;
  v_current numeric;
  v_statement numeric;
  v_link_count integer;
  v_future_count integer;
  v_paid_count integer;
  v_archived_single uuid;
  v_archived_parent uuid;
  v_archived_installment uuid;
  v_future_installment uuid;
  v_cut_archive uuid;
  v_archive_amount numeric;
  v_archive_status text;
  v_archive_paid_at timestamptz;
  v_single_amount numeric;
  v_parent_amount numeric;
begin
  -- Canonical full-current payment must still allocate its child and update
  -- both account/card aggregates atomically.
  perform public.add_card_expense(
    v_pay_card, 100, 'Canonical allocation pay', current_date, 1, 'Test', 'posted'
  );
  perform public.add_card_expense(
    v_pay_card,
    50,
    'Canonical allocation installment',
    (current_date - interval '5 days')::date,
    2,
    'Test',
    'posted'
  );
  perform public.pay_card_debt(v_pay_card, v_source, 125);

  select debt_amount, current_period_spending
  into v_debt, v_current
  from public.cards
  where id = v_pay_card;

  select
    (select count(*) from public.card_expenses
     where card_id = v_pay_card and current_settlement_id is not null)
    +
    (select count(*) from public.card_installments
     where card_id = v_pay_card and current_settlement_id is not null)
  into v_link_count
  ;

  select count(*)
  into v_future_count
  from public.card_installments
  where card_id = v_pay_card
    and status = 'scheduled'
    and current_settlement_id is null;

  select count(*)
  into v_paid_count
  from public.card_installments
  where card_id = v_pay_card
    and status = 'paid'
    and current_settlement_id is not null;

  select current_balance
  into v_balance
  from public.cards
  where id = v_source;

  if v_debt <> 25
     or v_current <> 0
     or v_balance <> 875
     or v_link_count <> 2
     or v_future_count <> 1
     or v_paid_count <> 1 then
    raise exception
      'CANONICAL PAY FAIL: debt/current/source/links/future/paid = %/%/%/%/%/%',
      v_debt, v_current, v_balance, v_link_count, v_future_count, v_paid_count;
  end if;

  if coalesce(
    current_setting('app.card_current_settlement_allocation_user_id', true),
    ''
  ) <> '' then
    raise exception 'SECURITY FAIL: current-settlement allocation context leaked';
  end if;

  -- Canonical statement cutting must still allocate the eligible historical
  -- child while moving the exact amount from current to statement debt.
  perform public.add_card_expense(
    v_cut_card,
    75,
    'Canonical statement allocation',
    (current_date - interval '40 days')::date,
    1,
    'Test',
    'posted'
  );
  perform public.add_card_expense(
    v_cut_card,
    50,
    'Canonical statement installment',
    (current_date - interval '5 days')::date,
    2,
    'Test',
    'posted'
  );
  perform public.cut_card_statement(v_cut_card);

  select statement_debt_amount, current_period_spending
  into v_statement, v_current
  from public.cards
  where id = v_cut_card;

  select
    (select count(*) from public.card_expenses
     where card_id = v_cut_card and statement_archive_id is not null)
    +
    (select count(*) from public.card_installments
     where card_id = v_cut_card and statement_archive_id is not null)
  into v_link_count
  ;

  select count(*)
  into v_future_count
  from public.card_installments
  where card_id = v_cut_card
    and status = 'scheduled'
    and statement_archive_id is null;

  if v_statement <> 100
     or v_current <> 0
     or v_link_count <> 2
     or v_future_count <> 1 then
    raise exception
      'CANONICAL CUT FAIL: statement/current/links/future = %/%/%/%',
      v_statement, v_current, v_link_count, v_future_count;
  end if;

  if coalesce(current_setting('app.card_statement_allocation_user_id', true), '') <> '' then
    raise exception 'SECURITY FAIL: statement allocation context leaked';
  end if;

  select id, amount
  into v_archived_single, v_single_amount
  from public.card_expenses
  where card_id = v_cut_card
    and description = 'Canonical statement allocation';

  select id, amount
  into v_archived_parent, v_parent_amount
  from public.card_expenses
  where card_id = v_cut_card
    and description = 'Canonical statement installment';

  select id
  into v_archived_installment
  from public.card_installments
  where card_id = v_cut_card
    and description = 'Canonical statement installment'
    and statement_archive_id is not null;

  select id
  into v_future_installment
  from public.card_installments
  where card_id = v_cut_card
    and description = 'Canonical statement installment'
    and statement_archive_id is null;

  -- The current-period edit algorithm must not run for either a directly
  -- archived single expense or an installment parent with an archived child.
  v_denied := false;
  begin
    perform public.update_card_expense(
      v_archived_single,
      150,
      'Canonical statement allocation',
      null,
      null,
      null,
      null
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: archived single expense edit was not denied';
  end if;

  v_denied := false;
  begin
    perform public.update_card_expense(
      v_archived_parent,
      60,
      'Canonical statement installment',
      null,
      null,
      null,
      null
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: archived installment parent edit was not denied';
  end if;

  -- Raw REST-style writes must not bypass the RPC preflight and make archive
  -- child sums stale while card/archive aggregates remain unchanged.
  v_denied := false;
  begin
    update public.card_expenses
    set amount = 80
    where id = v_archived_single;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw archived expense amount update was not denied';
  end if;

  v_denied := false;
  begin
    update public.card_installments
    set amount = 30
    where id = v_archived_installment;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw archived installment amount update was not denied';
  end if;

  v_denied := false;
  begin
    update public.card_expenses
    set status = 'cancelled', posted_at = null
    where id = v_archived_single;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw archived expense lifecycle update was not denied';
  end if;

  v_denied := false;
  begin
    update public.card_installments
    set status = 'paid', paid_at = now()
    where id = v_archived_installment;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw archived installment lifecycle update was not denied';
  end if;

  v_denied := false;
  begin
    update public.card_statement_archives
    set status = 'paid', paid_at = now(), payment_source_card_id = v_source
    where card_id = v_cut_card;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw statement lifecycle update was not denied';
  end if;

  v_denied := false;
  begin
    update public.card_statement_archives
    set statement_debt_amount = 80
    where card_id = v_cut_card;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw statement amount update was not denied';
  end if;

  v_denied := false;
  begin
    delete from public.card_expenses where id = v_archived_single;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw archived expense delete was not denied';
  end if;

  v_denied := false;
  begin
    delete from public.card_expenses where id = v_archived_parent;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw archived installment parent delete was not denied';
  end if;

  v_denied := false;
  begin
    delete from public.card_installments where id = v_archived_installment;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw archived installment delete was not denied';
  end if;

  v_denied := false;
  begin
    delete from public.card_installments where id = v_future_installment;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw archive-sibling installment delete was not denied';
  end if;

  v_denied := false;
  begin
    delete from public.card_statement_archives where card_id = v_cut_card;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: raw statement archive delete was not denied';
  end if;

  v_denied := false;
  begin
    perform public.cancel_card_expense(v_archived_single);
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: archived single cancellation was not denied';
  end if;

  v_denied := false;
  begin
    perform public.cancel_card_expense(v_archived_parent);
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: archived installment cancellation was not denied';
  end if;

  select debt_amount, statement_debt_amount, current_period_spending
  into v_debt, v_statement, v_current
  from public.cards
  where id = v_cut_card;

  select statement_debt_amount, status, paid_at
  into v_archive_amount, v_archive_status, v_archive_paid_at
  from public.card_statement_archives
  where card_id = v_cut_card;

  select amount into v_single_amount
  from public.card_expenses where id = v_archived_single;
  select amount into v_parent_amount
  from public.card_expenses where id = v_archived_parent;

  select
    (select count(*) from public.card_expenses
     where id in (v_archived_single, v_archived_parent))
    +
    (select count(*) from public.card_installments
     where id in (v_archived_installment, v_future_installment))
  into v_link_count;

  if v_debt <> 125
     or v_statement <> 100
     or v_current <> 0
     or v_archive_amount <> 100
     or v_archive_status <> 'open'
     or v_archive_paid_at is not null
     or v_single_amount <> 75
     or v_parent_amount <> 50
     or v_link_count <> 4 then
    raise exception
      'ARCHIVED MUTATION ROLLBACK FAIL: debt/statement/current/archive/status/single/parent/rows = %/%/%/%/%/%/%/%',
      v_debt, v_statement, v_current, v_archive_amount, v_archive_status,
      v_single_amount, v_parent_amount, v_link_count;
  end if;

  -- Statement payment is the legitimate archived-installment status change;
  -- the financial-field guard must not block it.
  select id into v_cut_archive
  from public.card_statement_archives
  where card_id = v_cut_card;

  perform public.pay_card_statement(v_cut_archive, v_source);

  select debt_amount, statement_debt_amount
  into v_debt, v_statement
  from public.cards
  where id = v_cut_card;

  select current_balance into v_balance
  from public.cards
  where id = v_source;

  select count(*) into v_paid_count
  from public.card_installments
  where id = v_archived_installment
    and status = 'paid';

  select status, paid_at
  into v_archive_status, v_archive_paid_at
  from public.card_statement_archives
  where id = v_cut_archive;

  if v_debt <> 25
     or v_statement <> 0
     or v_balance <> 775
     or v_paid_count <> 1
     or v_archive_status <> 'paid'
     or v_archive_paid_at is null then
    raise exception
      'CANONICAL STATEMENT PAY FAIL: debt/statement/source/paid/archive = %/%/%/%/%',
      v_debt, v_statement, v_balance, v_paid_count, v_archive_status;
  end if;

  if coalesce(current_setting('app.card_statement_payment_user_id', true), '') <> ''
     or coalesce(current_setting('app.card_statement_payment_id', true), '') <> '' then
    raise exception 'SECURITY FAIL: statement-payment context leaked';
  end if;

  -- Clean rebuild must fail before deleting immutable early-payment evidence or
  -- a partially historical paid installment plan.
  v_denied := false;
  begin
    perform public.reset_card_import_data(v_pay_card);
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: settlement-bearing import reset was not denied';
  end if;

  v_denied := false;
  begin
    perform public.reset_card_import_data(v_cut_card);
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'INTEGRITY FAIL: paid-installment import reset was not denied';
  end if;

  select
    (select count(*) from public.card_expenses
     where card_id = v_pay_card and current_settlement_id is not null)
    +
    (select count(*) from public.card_installments
     where card_id = v_pay_card and current_settlement_id is not null)
    +
    (select count(*) from public.card_statement_archives
     where card_id = v_cut_card and status = 'paid')
    +
    (select count(*) from public.card_installments
     where card_id = v_cut_card and statement_archive_id = v_cut_archive)
  into v_link_count;

  if v_link_count <> 4 then
    raise exception 'IMPORT RESET ROLLBACK FAIL: immutable evidence rows = %', v_link_count;
  end if;

  if coalesce(current_setting('app.card_import_reset_user_id', true), '') <> ''
     or coalesce(current_setting('app.card_import_reset_card_id', true), '') <> '' then
    raise exception 'SECURITY FAIL: import-reset context leaked after rejection';
  end if;

  -- Settling this period's posted installment must not freeze the future
  -- sibling. Once due, normal maintenance posts it and the next statement cut
  -- may archive it under the canonical allocation context.
  update public.card_installments
  set due_month = (current_date - interval '40 days')::date
  where card_id = v_pay_card
    and status = 'scheduled';

  perform public.post_due_card_installments();

  select count(*)
  into v_link_count
  from public.card_installments
  where card_id = v_pay_card
    and status = 'posted'
    and current_settlement_id is null
    and statement_archive_id is null;

  if v_link_count <> 1 then
    raise exception 'FUTURE INSTALLMENT POST FAIL: posted rows = %', v_link_count;
  end if;

  perform public.cut_card_statement(v_pay_card);

  select debt_amount, statement_debt_amount, current_period_spending
  into v_debt, v_statement, v_current
  from public.cards
  where id = v_pay_card;

  select count(*)
  into v_link_count
  from public.card_installments
  where card_id = v_pay_card
    and status = 'posted'
    and current_settlement_id is null
    and statement_archive_id is not null;

  if v_debt <> 25 or v_statement <> 25 or v_current <> 0 or v_link_count <> 1 then
    raise exception
      'FUTURE INSTALLMENT CUT FAIL: debt/statement/current/archived = %/%/%/%',
      v_debt, v_statement, v_current, v_link_count;
  end if;

  insert into public.card_expenses (
    id, user_id, card_id, amount, description, installment_amount
  )
  values
    (v_expense_current, v_user, v_forge_card, 20, 'Forge current update', 20),
    (v_expense_archive, v_user, v_forge_card, 20, 'Forge archive update', 20),
    (v_delete_expense, v_user, v_forge_card, 20, 'Normal delete guard path', 20);

  delete from public.card_expenses where id = v_delete_expense;
  get diagnostics v_link_count = row_count;
  if v_link_count <> 1 then
    raise exception 'TRIGGER FAIL: normal unallocated expense delete affected % rows', v_link_count;
  end if;

  insert into public.card_installments (
    id, user_id, card_id, installment_no, installment_count, due_month,
    amount, description, status
  )
  values
    (
      v_installment_current, v_user, v_forge_card, 1, 1, current_date,
      20, 'Forge installment current', 'posted'
    ),
    (
      v_installment_archive, v_user, v_forge_card, 1, 1, current_date,
      20, 'Forge installment archive', 'posted'
    );

  -- Backup restore currently replays historical archive children directly.
  -- Same-user/same-card INSERT is intentionally allowed and RLS must reject a
  -- marker whose archive belongs to a different card.
  insert into public.card_expenses (
    id, user_id, card_id, amount, description, installment_amount,
    status, posted_at, statement_archive_id
  )
  values (
    v_archive_insert_expense, v_user, v_forge_card, 10,
    'Restore archive expense fixture', 10, 'posted', now(), v_old_archive
  );

  insert into public.card_installments (
    id, user_id, card_id, installment_no, installment_count, due_month,
    amount, description, status, posted_at, statement_archive_id
  )
  values (
    v_archive_insert_installment, v_user, v_forge_card, 1, 1, current_date,
    10, 'Restore archive installment fixture', 'posted', now(), v_old_archive
  );

  select
    (select count(*) from public.card_expenses where id = v_archive_insert_expense)
    +
    (select count(*) from public.card_installments where id = v_archive_insert_installment)
  into v_link_count;
  if v_link_count <> 2 then
    raise exception 'RESTORE COMPAT FAIL: same-card archive INSERT created % rows', v_link_count;
  end if;

  v_denied := false;
  begin
    insert into public.card_expenses (
      user_id, card_id, amount, description, installment_amount,
      statement_archive_id
    )
    values (
      v_user, v_pay_card, 10, 'Cross-card archive insert', 10, v_old_archive
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = '42501';
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: cross-card expense archive INSERT was not denied by RLS';
  end if;

  v_denied := false;
  begin
    insert into public.card_installments (
      user_id, card_id, installment_no, installment_count, due_month,
      amount, description, status, statement_archive_id
    )
    values (
      v_user, v_pay_card, 1, 1, current_date, 10,
      'Cross-card archive installment insert', 'posted', v_old_archive
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = '42501';
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: cross-card installment archive INSERT was not denied by RLS';
  end if;

  -- Same-card RLS checks would accept all four parent ids. The trigger must
  -- reject the forged NULL -> parent transitions after canonical GUCs cleared.
  v_denied := false;
  begin
    update public.card_expenses
    set current_settlement_id = v_old_settlement
    where id = v_expense_current;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: forged expense settlement update was not denied';
  end if;

  v_denied := false;
  begin
    update public.card_installments
    set current_settlement_id = v_old_settlement
    where id = v_installment_current;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: forged installment settlement update was not denied';
  end if;

  v_denied := false;
  begin
    update public.card_expenses
    set statement_archive_id = v_old_archive
    where id = v_expense_archive;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: forged expense archive update was not denied';
  end if;

  v_denied := false;
  begin
    update public.card_installments
    set statement_archive_id = v_old_archive
    where id = v_installment_archive;
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: forged installment archive update was not denied';
  end if;

  -- Current-settlement markers are never a valid direct child INSERT path.
  v_denied := false;
  begin
    insert into public.card_expenses (
      user_id, card_id, amount, description, installment_amount,
      current_settlement_id
    )
    values (
      v_user, v_forge_card, 20, 'Forge current insert', 20,
      v_old_settlement
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: forged expense settlement insert was not denied';
  end if;

  v_denied := false;
  begin
    insert into public.card_installments (
      user_id, card_id, installment_no, installment_count, due_month,
      amount, description, current_settlement_id
    )
    values (
      v_user, v_forge_card, 1, 1, current_date, 20,
      'Forge installment current insert', v_old_settlement
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = 'P0001';
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: forged installment settlement insert was not denied';
  end if;

  raise notice 'Card allocation regression OK: canonical paths allowed, forged paths denied.';
end $$;

-- A different authenticated subject cannot even target the protected rows;
-- RLS filters the UPDATE to zero rows before the guard can allocate anything.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rows integer;
  v_denied boolean := false;
  v_error_state text;
begin
  update public.card_expenses
  set current_settlement_id = 'a1000000-0000-4000-8000-000000000005'
  where id = 'a1000000-0000-4000-8000-000000000007';
  get diagnostics v_rows = row_count;

  if v_rows <> 0 then
    raise exception 'SECURITY FAIL: cross-user allocation reached % rows', v_rows;
  end if;

  begin
    insert into public.card_expenses (
      user_id, card_id, amount, description, installment_amount,
      statement_archive_id
    )
    values (
      '11111111-1111-1111-1111-111111111111',
      'a1000000-0000-4000-8000-000000000003',
      10,
      'Cross-user archive insert',
      10,
      'a1000000-0000-4000-8000-000000000006'
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate;
    v_denied := v_error_state = '42501';
  end;

  if not v_denied then
    raise exception 'SECURITY FAIL: cross-user archive INSERT was not denied by RLS';
  end if;
end $$;

-- The canonical clean-import reset may delete a non-paid/open archive scope
-- and must clear its card-bound context. Run after cross-user checks because it
-- deliberately removes the forge fixtures above.
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_rows integer;
begin
  perform public.reset_card_import_data('a1000000-0000-4000-8000-000000000003');

  select
    (select count(*) from public.card_expenses
     where card_id = 'a1000000-0000-4000-8000-000000000003')
    +
    (select count(*) from public.card_installments
     where card_id = 'a1000000-0000-4000-8000-000000000003')
    +
    (select count(*) from public.card_statement_archives
     where card_id = 'a1000000-0000-4000-8000-000000000003')
  into v_rows;

  if v_rows <> 0 then
    raise exception 'CANONICAL IMPORT RESET FAIL: open scope retained % rows', v_rows;
  end if;

  if coalesce(current_setting('app.card_import_reset_user_id', true), '') <> ''
     or coalesce(current_setting('app.card_import_reset_card_id', true), '') <> '' then
    raise exception 'SECURITY FAIL: import-reset context leaked';
  end if;
end $$;

reset role;
rollback;
