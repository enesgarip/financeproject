-- Banking simplification P0: shared account movement helpers.
--
-- Every RPC that debits/credits a bank account duplicates the same 4-step
-- pattern: lock row, validate ownership + card_type + balance, update balance,
-- write history. The first three steps (lock + validate + debit/credit) are now
-- extracted into two internal helper functions so each RPC only owns its domain
-- logic and the history insert.
--
-- The helpers live in the non-exposed `private` schema and are NOT granted to
-- `authenticated`. Public RPCs run as SECURITY DEFINER, keep their explicit
-- auth.uid() ownership checks, and call these helpers inside the same
-- transaction. The account_ledger trigger fires automatically on balance
-- changes as before.

--------------------------------------------------------------------------------
-- 1. Helper functions
--------------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create or replace function private.debit_bank_account(
  p_card_id uuid,
  p_amount numeric
)
returns public.cards
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Tutar 0 dan buyuk olmali.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kaynak hesap bulunamadi.';
  end if;

  if v_card.card_type <> 'banka_karti' then
    raise exception 'Kaynak hesap banka karti olmali.';
  end if;

  if v_card.current_balance < p_amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance - p_amount,
      updated_at = now()
  where id = p_card_id
  returning * into v_card;

  return v_card;
end;
$$;

-- Internal helper: no GRANT to authenticated.
revoke all on function private.debit_bank_account(uuid, numeric) from public;
revoke all on function private.debit_bank_account(uuid, numeric) from anon;
revoke all on function private.debit_bank_account(uuid, numeric) from authenticated;

create or replace function private.credit_bank_account(
  p_card_id uuid,
  p_amount numeric
)
returns public.cards
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Tutar 0 dan buyuk olmali.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Hesap bulunamadi.';
  end if;

  if v_card.card_type <> 'banka_karti' then
    raise exception 'Hedef hesap banka karti olmali.';
  end if;

  update public.cards
  set current_balance = current_balance + p_amount,
      updated_at = now()
  where id = p_card_id
  returning * into v_card;

  return v_card;
end;
$$;

-- Internal helper: no GRANT to authenticated.
revoke all on function private.credit_bank_account(uuid, numeric) from public;
revoke all on function private.credit_bank_account(uuid, numeric) from anon;
revoke all on function private.credit_bank_account(uuid, numeric) from authenticated;

--------------------------------------------------------------------------------
-- 2. Refactored RPCs
--------------------------------------------------------------------------------

-- 2a. record_manual_account_movement
-- Was: inline lock + validate + debit/credit
-- Now: delegates to debit_bank_account / credit_bank_account

create or replace function public.record_manual_account_movement(
  p_card_id uuid,
  p_amount numeric,
  p_direction text,
  p_note text default null
)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_card public.cards%rowtype;
begin
  if p_direction not in ('in', 'out') then
    raise exception 'Gecersiz hareket yonu.';
  end if;

  if p_direction = 'out' then
    v_card := private.debit_bank_account(p_card_id, v_amount);
  else
    v_card := private.credit_bank_account(p_card_id, v_amount);
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_card.user_id,
    'transfer',
    v_card.card_name || (case when p_direction = 'in' then ' para girişi' else ' para çıkışı' end),
    v_amount,
    'cards',
    v_card.id,
    coalesce(nullif(btrim(p_note), ''), case when p_direction = 'in' then 'Banka kartına para geldi.' else 'Banka kartından para çıktı.' end)
  );

  return v_card;
end;
$$;

grant execute on function public.record_manual_account_movement(uuid, numeric, text, text) to authenticated;

-- 2b. transfer_between_accounts
-- Was: inline lock + validate + debit source + credit target
-- Now: delegates to debit_bank_account + credit_bank_account

create or replace function public.transfer_between_accounts(
  p_source_card_id uuid,
  p_target_card_id uuid,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_source public.cards%rowtype;
  v_target public.cards%rowtype;
begin
  if p_source_card_id = p_target_card_id then
    raise exception 'Kaynak ve hedef hesap ayni olamaz.';
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_amount);
  v_target := private.credit_bank_account(p_target_card_id, v_amount);

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_source.user_id,
    'transfer',
    'Hesaplar arasi transfer',
    v_amount,
    'cards',
    v_source.id,
    v_source.card_name || ' hesabindan ' || v_target.card_name || ' hesabina aktarildi.' ||
      case when nullif(trim(p_note), '') is not null then ' Not: ' || trim(p_note) else '' end
  );

  return jsonb_build_object(
    'source_card_id', v_source.id,
    'source_balance', v_source.current_balance,
    'target_card_id', v_target.id,
    'target_balance', v_target.current_balance
  );
end;
$$;

grant execute on function public.transfer_between_accounts(uuid, uuid, numeric, text) to authenticated;

-- 2c. pay_card_debt
-- Was: inline source lock + validate, inline card lock + validate, inline debit
-- Now: card validation first, then debit_bank_account for source

create or replace function public.pay_card_debt(
  p_card_id uuid,
  p_source_card_id uuid,
  p_amount numeric
)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_paid_card public.cards%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_payable_amount numeric(14, 2);
  v_remaining_payment numeric(14, 2);
  v_next_statement_debt numeric(14, 2);
  v_next_current_period numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if v_amount <= 0 then
    raise exception 'Odeme tutari 0 dan buyuk olmali.';
  end if;

  if p_card_id = p_source_card_id then
    raise exception 'Kaynak hesap ve borc karti ayni olamaz.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kredi karti bulunamadi.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Borc odenecek kart kredi karti olmali.';
  end if;

  v_payable_amount := greatest(0, v_card.statement_debt_amount + v_card.current_period_spending);

  if v_payable_amount <= 0 then
    raise exception 'Odenecek kesinlesmis kart borcu yok.';
  end if;

  if v_amount > v_payable_amount + 0.01 then
    raise exception 'Odeme tutari ekstre ve donem ici kesinlesmis kart borcundan buyuk olamaz.';
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_amount);

  v_remaining_payment := v_amount;
  v_next_statement_debt := greatest(0, v_card.statement_debt_amount - v_remaining_payment);
  v_remaining_payment := greatest(0, v_remaining_payment - v_card.statement_debt_amount);
  v_next_current_period := greatest(0, v_card.current_period_spending - v_remaining_payment);

  update public.cards
  set debt_amount = greatest(0, debt_amount - v_amount),
      statement_debt_amount = v_next_statement_debt,
      current_period_spending = v_next_current_period,
      updated_at = now()
  where id = v_card.id
  returning * into v_paid_card;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_card.card_name || ' kart borcu odendi',
    v_amount,
    'cards',
    v_card.id,
    v_source.card_name || ' hesabindan odendi. Gelecek kredi karti taksitleri manuel kapatilmadi.'
  );

  return v_paid_card;
end;
$$;

grant execute on function public.pay_card_debt(uuid, uuid, numeric) to authenticated;

-- 2d. pay_card_statement
-- Was: inline source lock + validate + debit
-- Now: statement + card validation first, then debit_bank_account for source

create or replace function public.pay_card_statement(
  p_statement_id uuid,
  p_source_card_id uuid
)
returns public.card_statement_archives
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_statement public.card_statement_archives%rowtype;
  v_paid_statement public.card_statement_archives%rowtype;
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_payment_amount numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_statement
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Ekstre bulunamadi.';
  end if;

  if v_statement.status <> 'open' then
    raise exception 'Bu ekstre zaten kapali.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_statement.card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstre odemesi sadece kredi karti icin kullanilabilir.';
  end if;

  v_payment_amount := round(greatest(0, v_statement.statement_debt_amount), 2);

  if v_payment_amount <= 0 then
    raise exception 'Ekstre tutari 0 oldugu icin odeme yapilamaz.';
  end if;

  if v_card.statement_debt_amount + 0.01 < v_payment_amount or v_card.debt_amount + 0.01 < v_payment_amount then
    raise exception 'Kart borcu ekstre tutariyla uyusmuyor. Veri sagligi kontrolunu calistir.';
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_payment_amount);

  update public.cards
  set debt_amount = greatest(0, debt_amount - v_payment_amount),
      statement_debt_amount = greatest(0, statement_debt_amount - v_payment_amount),
      updated_at = now()
  where id = v_card.id;

  update public.card_installments
  set status = 'paid',
      paid_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and statement_archive_id = v_statement.id
    and status <> 'paid';

  update public.card_statement_archives
  set status = 'paid',
      paid_at = now(),
      payment_source_card_id = v_source.id,
      updated_at = now()
  where id = v_statement.id
  returning * into v_paid_statement;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_card.card_name || ' ekstresi odendi',
    v_payment_amount,
    'card_statement_archives',
    v_statement.id,
    v_source.card_name || ' hesabindan odendi. Bagli kart taksitleri otomatik kapatildi.'
  );

  return v_paid_statement;
end;
$$;

grant execute on function public.pay_card_statement(uuid, uuid) to authenticated;

-- 2e. pay_loan_installment
-- Was: inline source lock + validate + debit
-- Now: installment + loan validation first, then debit_bank_account for source

create or replace function public.pay_loan_installment(
  p_installment_id uuid,
  p_source_card_id uuid
)
returns public.loan_installments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_installment public.loan_installments%rowtype;
  v_paid_installment public.loan_installments%rowtype;
  v_loan public.loans%rowtype;
  v_source public.cards%rowtype;
  v_remaining_amount numeric(14, 2);
  v_remaining_installments integer;
  v_paid_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_installment
  from public.loan_installments
  where id = p_installment_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Taksit bulunamadi.';
  end if;

  if v_installment.status = 'ödendi' then
    raise exception 'Bu taksit zaten odendi.';
  end if;

  if v_installment.amount <= 0 then
    raise exception 'Taksit tutari 0 dan buyuk olmali.';
  end if;

  select *
  into v_loan
  from public.loans
  where id = v_installment.loan_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kredi bulunamadi.';
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_installment.amount);

  update public.loan_installments
  set status = 'ödendi',
      paid_at = v_paid_at,
      updated_at = v_paid_at
  where id = v_installment.id
  returning * into v_paid_installment;

  select coalesce(sum(amount), 0), count(*)::integer
  into v_remaining_amount, v_remaining_installments
  from public.loan_installments
  where loan_id = v_loan.id
    and status <> 'ödendi';

  update public.loans
  set remaining_amount = v_remaining_amount,
      remaining_installments = v_remaining_installments,
      status = case when v_remaining_installments = 0 then 'closed' else 'active' end,
      updated_at = now()
  where id = v_loan.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'loan',
    v_loan.loan_name || ' ' || v_installment.installment_no || '. taksit odemesi',
    v_installment.amount,
    'loan_installments',
    v_installment.id,
    v_source.card_name || ' hesabindan odendi. Vade: ' || to_char(v_installment.due_date, 'YYYY-MM-DD')
  );

  return v_paid_installment;
end;
$$;

grant execute on function public.pay_loan_installment(uuid, uuid) to authenticated;

-- 2f. pay_payment
-- Was: inline source lock + bank debit or credit card spending
-- Now: bank path uses debit_bank_account; credit card path stays inline

drop function if exists public.pay_payment(uuid, uuid);
drop function if exists public.pay_payment(uuid, uuid, numeric);

create or replace function public.pay_payment(
  p_payment_id uuid,
  p_source_card_id uuid,
  p_paid_amount numeric default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_payment public.payments%rowtype;
  v_paid_payment public.payments%rowtype;
  v_source public.cards%rowtype;
  v_paid_amount numeric(14, 2);
  v_next_month_start date;
  v_next_month_end date;
  v_next_due_day integer;
  v_next_due_date date;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_payment
  from public.payments
  where id = p_payment_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Odeme bulunamadi.';
  end if;

  if v_payment.status <> 'bekliyor' then
    raise exception 'Bu odeme bekliyor durumunda degil.';
  end if;

  v_paid_amount := round(coalesce(p_paid_amount, v_payment.amount), 2);

  if v_paid_amount <= 0 then
    raise exception 'Odeme tutari 0 dan buyuk olmali.';
  end if;

  -- Read the source card to determine bank vs credit card path.
  select *
  into v_source
  from public.cards
  where id = p_source_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kaynak hesap bulunamadi.';
  end if;

  if v_source.card_type = 'banka_karti' then
    -- Bank path: delegate to shared helper (re-lock is a no-op).
    v_source := private.debit_bank_account(p_source_card_id, v_paid_amount);
  elsif v_source.card_type = 'kredi_karti' then
    -- Credit card path: add as card spending (different logic, stays inline).
    update public.cards
    set debt_amount = debt_amount + v_paid_amount,
        current_period_spending = current_period_spending + v_paid_amount,
        updated_at = now()
    where id = v_source.id;

    insert into public.card_expenses (
      user_id,
      card_id,
      spent_at,
      amount,
      description,
      category,
      installment_count,
      installment_amount,
      status,
      posted_at,
      note
    )
    values (
      v_user_id,
      v_source.id,
      current_date,
      v_paid_amount,
      v_payment.title,
      v_payment.category,
      1,
      v_paid_amount,
      'posted',
      now(),
      'Odeme kaydindan olusturuldu. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
    );
  else
    raise exception 'Kaynak kart tipi desteklenmiyor.';
  end if;

  if v_payment.recurrence = 'monthly' then
    v_next_month_start := (date_trunc('month', v_payment.due_date)::date + interval '1 month')::date;
    v_next_month_end := (date_trunc('month', v_next_month_start)::date + interval '1 month - 1 day')::date;
    v_next_due_day := least(
      coalesce(v_payment.recurrence_day, extract(day from v_payment.due_date)::integer),
      extract(day from v_next_month_end)::integer
    );
    v_next_due_date := v_next_month_start + (v_next_due_day - 1);

    if v_payment.recurrence_end_date is not null and v_next_due_date > v_payment.recurrence_end_date then
      update public.payments
      set amount = v_paid_amount,
          amount_status = 'exact',
          status = 'ödendi',
          updated_at = now()
      where id = v_payment.id
      returning * into v_paid_payment;
    else
      update public.payments
      set amount = v_paid_amount,
          amount_status = case
            when v_payment.payment_method = 'bank_auto' or v_payment.amount_status = 'estimated' then 'estimated'
            else 'exact'
          end,
          due_date = v_next_due_date,
          status = 'bekliyor',
          updated_at = now()
      where id = v_payment.id
      returning * into v_paid_payment;
    end if;
  else
    update public.payments
    set amount = v_paid_amount,
        amount_status = 'exact',
        status = 'ödendi',
        updated_at = now()
    where id = v_payment.id
    returning * into v_paid_payment;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_payment.title || ' odendi',
    v_paid_amount,
    'payments',
    v_payment.id,
    case
      when v_source.card_type = 'kredi_karti'
        then v_source.card_name || ' kredi kartina harcama olarak islendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
      else v_source.card_name || ' hesabindan odendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
    end
  );

  return v_paid_payment;
end;
$$;

grant execute on function public.pay_payment(uuid, uuid, numeric) to authenticated;

-- 2g. settle_personal_debt
-- Was: inline account lock + validate + debit/credit based on debt direction
-- Now: delegates to debit_bank_account / credit_bank_account

create or replace function public.settle_personal_debt(
  p_debt_id uuid,
  p_account_card_id uuid
)
returns public.debts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_debt public.debts%rowtype;
  v_closed_debt public.debts%rowtype;
  v_account public.cards%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_debt
  from public.debts
  where id = p_debt_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Borc kaydi bulunamadi.';
  end if;

  if v_debt.status <> 'açık' then
    raise exception 'Bu borc kaydi acik durumda degil.';
  end if;

  if v_debt.estimated_value_try <= 0 then
    raise exception 'Borc tutari 0 dan buyuk olmali.';
  end if;

  if v_debt.direction = 'borç_aldım' then
    v_account := private.debit_bank_account(p_account_card_id, v_debt.estimated_value_try);
  else
    v_account := private.credit_bank_account(p_account_card_id, v_debt.estimated_value_try);
  end if;

  update public.debts
  set status = 'kapandı',
      updated_at = now()
  where id = v_debt.id
  returning * into v_closed_debt;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'debt',
    v_debt.person_name || ' borç kaydı kapandı',
    v_debt.estimated_value_try,
    'debts',
    v_debt.id,
    case
      when v_debt.direction = 'borç_aldım' then v_account.card_name || ' hesabından ödendi.'
      else v_account.card_name || ' hesabına tahsil edildi.'
    end
  );

  return v_closed_debt;
end;
$$;

grant execute on function public.settle_personal_debt(uuid, uuid) to authenticated;

--------------------------------------------------------------------------------
-- 3. Explicit public RPC grants
--------------------------------------------------------------------------------

revoke execute on function public.record_manual_account_movement(uuid, numeric, text, text) from public;
revoke execute on function public.record_manual_account_movement(uuid, numeric, text, text) from anon;
grant execute on function public.record_manual_account_movement(uuid, numeric, text, text) to authenticated;

revoke execute on function public.transfer_between_accounts(uuid, uuid, numeric, text) from public;
revoke execute on function public.transfer_between_accounts(uuid, uuid, numeric, text) from anon;
grant execute on function public.transfer_between_accounts(uuid, uuid, numeric, text) to authenticated;

revoke execute on function public.pay_card_debt(uuid, uuid, numeric) from public;
revoke execute on function public.pay_card_debt(uuid, uuid, numeric) from anon;
grant execute on function public.pay_card_debt(uuid, uuid, numeric) to authenticated;

revoke execute on function public.pay_card_statement(uuid, uuid) from public;
revoke execute on function public.pay_card_statement(uuid, uuid) from anon;
grant execute on function public.pay_card_statement(uuid, uuid) to authenticated;

revoke execute on function public.pay_loan_installment(uuid, uuid) from public;
revoke execute on function public.pay_loan_installment(uuid, uuid) from anon;
grant execute on function public.pay_loan_installment(uuid, uuid) to authenticated;

revoke execute on function public.pay_payment(uuid, uuid, numeric) from public;
revoke execute on function public.pay_payment(uuid, uuid, numeric) from anon;
grant execute on function public.pay_payment(uuid, uuid, numeric) to authenticated;

revoke execute on function public.settle_personal_debt(uuid, uuid) from public;
revoke execute on function public.settle_personal_debt(uuid, uuid) from anon;
grant execute on function public.settle_personal_debt(uuid, uuid) to authenticated;
