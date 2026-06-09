begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000101',
  'authenticated',
  'authenticated',
  'finance-regression@example.test',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);

insert into public.cards (
  id,
  user_id,
  bank_name,
  card_name,
  card_type,
  current_balance,
  credit_limit,
  debt_amount,
  statement_debt_amount,
  current_period_spending,
  provision_amount,
  statement_day,
  due_day
)
values
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101',
    'Test Bank',
    'Main Account',
    'banka_karti',
    10000,
    0,
    0,
    0,
    0,
    0,
    null,
    null
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000101',
    'Test Bank',
    'Statement Card',
    'kredi_karti',
    0,
    20000,
    0,
    0,
    0,
    0,
    1,
    10
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000101',
    'Test Bank',
    'Auto Statement Card',
    'kredi_karti',
    0,
    10000,
    250,
    0,
    250,
    0,
    1,
    10
  );

select public.add_card_expense(
  '00000000-0000-4000-8000-000000000202',
  1000,
  'Normal card spending',
  current_date,
  1,
  'Diğer',
  'posted'
);

select public.add_card_expense(
  '00000000-0000-4000-8000-000000000202',
  6000,
  'Installment spending',
  current_date,
  3,
  'Alışveriş',
  'posted'
);

reset role;

do $$
declare
  v_card public.cards%rowtype;
  v_installment_count integer;
  v_posted_count integer;
  v_scheduled_count integer;
begin
  select * into v_card from public.cards where id = '00000000-0000-4000-8000-000000000202';

  if v_card.debt_amount <> 7000 then
    raise exception 'Expected card debt 7000 after spending, got %', v_card.debt_amount;
  end if;

  if v_card.current_period_spending <> 3000 then
    raise exception 'Expected current period 3000 after spending, got %', v_card.current_period_spending;
  end if;

  select count(*), count(*) filter (where status = 'posted'), count(*) filter (where status = 'scheduled')
  into v_installment_count, v_posted_count, v_scheduled_count
  from public.card_installments
  where card_id = '00000000-0000-4000-8000-000000000202';

  if v_installment_count <> 3 or v_posted_count <> 1 or v_scheduled_count <> 2 then
    raise exception 'Unexpected installment split count %, posted %, scheduled %', v_installment_count, v_posted_count, v_scheduled_count;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);

select public.cut_card_statement('00000000-0000-4000-8000-000000000202');
select public.cut_card_statement('00000000-0000-4000-8000-000000000202');

reset role;

do $$
declare
  v_statement_count integer;
  v_linked_installments integer;
  v_card public.cards%rowtype;
begin
  -- Day-after cut semantics derive the period from the statement boundary, which
  -- may land in the previous month when run on the 1st. The dedup guarantee under
  -- test is "two cut calls -> exactly one archive", so count all archives instead
  -- of filtering by the current calendar month.
  select count(*)
  into v_statement_count
  from public.card_statement_archives
  where card_id = '00000000-0000-4000-8000-000000000202';

  if v_statement_count <> 1 then
    raise exception 'Expected one statement archive, got %', v_statement_count;
  end if;

  select count(*)
  into v_linked_installments
  from public.card_installments
  where card_id = '00000000-0000-4000-8000-000000000202'
    and statement_archive_id is not null;

  if v_linked_installments <> 1 then
    raise exception 'Expected one installment linked to statement, got %', v_linked_installments;
  end if;

  select * into v_card from public.cards where id = '00000000-0000-4000-8000-000000000202';

  if v_card.statement_debt_amount <> 3000 or v_card.current_period_spending <> 2000 or v_card.debt_amount <> 7000 then
    raise exception 'Unexpected card split after statement: statement %, current %, debt %',
      v_card.statement_debt_amount,
      v_card.current_period_spending,
      v_card.debt_amount;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);

select public.pay_card_statement(
  (
    select id
    from public.card_statement_archives
    where card_id = '00000000-0000-4000-8000-000000000202'
    limit 1
  ),
  '00000000-0000-4000-8000-000000000201'
);

select public.cut_due_card_statements();

reset role;

do $$
declare
  v_card public.cards%rowtype;
  v_account public.cards%rowtype;
  v_statement public.card_statement_archives%rowtype;
  v_paid_linked_installments integer;
  v_auto_statement_count integer;
begin
  select * into v_card from public.cards where id = '00000000-0000-4000-8000-000000000202';
  select * into v_account from public.cards where id = '00000000-0000-4000-8000-000000000201';
  select * into v_statement from public.card_statement_archives where card_id = '00000000-0000-4000-8000-000000000202';

  if v_statement.status <> 'paid' then
    raise exception 'Expected statement paid, got %', v_statement.status;
  end if;

  if v_card.debt_amount <> 4000 or v_card.statement_debt_amount <> 0 or v_card.current_period_spending <> 2000 then
    raise exception 'Unexpected card split after statement payment: statement %, current %, debt %',
      v_card.statement_debt_amount,
      v_card.current_period_spending,
      v_card.debt_amount;
  end if;

  if v_account.current_balance <> 7000 then
    raise exception 'Expected account balance 7000 after payment, got %', v_account.current_balance;
  end if;

  select count(*)
  into v_paid_linked_installments
  from public.card_installments
  where card_id = '00000000-0000-4000-8000-000000000202'
    and statement_archive_id = v_statement.id
    and status = 'paid';

  if v_paid_linked_installments <> 1 then
    raise exception 'Expected linked installment to become paid, got %', v_paid_linked_installments;
  end if;

  select count(*)
  into v_auto_statement_count
  from public.card_statement_archives
  where card_id = '00000000-0000-4000-8000-000000000203';

  if v_auto_statement_count <> 1 then
    raise exception 'Expected automatic statement count 1, got %', v_auto_statement_count;
  end if;
end $$;

rollback;
