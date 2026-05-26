alter table public.cards
add column if not exists provision_amount numeric(14, 2) not null default 0 check (provision_amount >= 0);

alter table public.card_expenses
add column if not exists status text,
add column if not exists posted_at timestamptz;

update public.card_expenses
set status = 'posted'
where status is null
  or status not in ('provision', 'posted', 'cancelled');

alter table public.card_expenses
alter column status set default 'posted',
alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'card_expenses_status_check'
      and conrelid = 'public.card_expenses'::regclass
  ) then
    alter table public.card_expenses
    add constraint card_expenses_status_check
    check (status in ('provision', 'posted', 'cancelled'));
  end if;
end;
$$;

update public.card_expenses
set posted_at = coalesce(posted_at, created_at)
where status = 'posted'
  and posted_at is null;

update public.cards as card
set provision_amount = coalesce((
  select sum(expense.amount)
  from public.card_expenses as expense
  where expense.card_id = card.id
    and expense.user_id = card.user_id
    and expense.status = 'provision'
), 0)
where card.card_type = 'kredi_karti';

create index if not exists card_expenses_user_status_spent_at_idx on public.card_expenses(user_id, status, spent_at desc);
create index if not exists card_expenses_card_status_idx on public.card_expenses(card_id, status);

drop function if exists public.add_card_expense(uuid, numeric, text, date, integer, text);
drop function if exists public.add_card_expense(uuid, numeric, text, date, integer, text, text);

create or replace function public.add_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default current_date,
  p_installment_count integer default 1,
  p_category text default 'Diğer',
  p_status text default 'posted'
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_installment_count integer := greatest(1, least(coalesce(p_installment_count, 1), 36));
  v_installment_no integer;
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_spent_at date := coalesce(p_spent_at, current_date);
  v_status text := case
    when lower(btrim(coalesce(p_status, 'posted'))) = 'provision' then 'provision'
    else 'posted'
  end;
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Diğer');
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutari 0 dan buyuk olmali.';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama aciklamasi zorunlu.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

  if v_card.card_type = 'banka_karti' and v_card.current_balance < p_amount then
    raise exception 'Banka karti bakiyesi yetersiz.';
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + case when v_status = 'posted' then v_first_installment_amount else 0 end,
        provision_amount = provision_amount + case when v_status = 'provision' then p_amount else 0 end,
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance - p_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

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
    posted_at
  )
  values (
    v_user_id,
    p_card_id,
    v_spent_at,
    p_amount,
    btrim(coalesce(p_description, '')),
    v_category,
    v_installment_count,
    v_first_installment_amount,
    v_status,
    case when v_status = 'posted' then now() else null end
  )
  returning * into v_expense;

  if v_card.card_type = 'kredi_karti' and v_status = 'posted' and v_installment_count > 1 then
    for v_installment_no in 1..v_installment_count loop
      v_installment_amount := round(p_amount / v_installment_count, 2);
      if v_installment_no = v_installment_count then
        v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
      end if;

      v_due_month := (date_trunc('month', v_spent_at)::date + ((v_installment_no - 1) * interval '1 month'))::date;

      insert into public.card_installments (
        user_id,
        card_id,
        card_expense_id,
        installment_no,
        installment_count,
        due_month,
        amount,
        description,
        category,
        status,
        posted_at
      )
      values (
        v_user_id,
        p_card_id,
        v_expense.id,
        v_installment_no,
        v_installment_count,
        v_due_month,
        v_installment_amount,
        btrim(coalesce(p_description, '')),
        v_category,
        case when v_installment_no = 1 then 'posted' else 'scheduled' end,
        case when v_installment_no = 1 then now() else null end
      );
    end loop;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    btrim(coalesce(p_description, '')),
    p_amount,
    'card_expenses',
    v_expense.id,
    case
      when v_status = 'provision' then 'Kart harcamasi provizyona alindi.'
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcamasi.'
      else 'Pesin kart harcamasi.'
    end
  );

  return v_expense;
end;
$$;

grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text) to authenticated;

create or replace function public.post_card_provision(
  p_expense_id uuid
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_posted_expense public.card_expenses%rowtype;
  v_installment_no integer;
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Provizyon bulunamadi.';
  end if;

  if v_expense.status <> 'provision' then
    raise exception 'Bu islem provizyonda degil.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_expense.card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  v_first_installment_amount := case
    when v_expense.installment_count = 1 then v_expense.amount
    else round(v_expense.amount / v_expense.installment_count, 2)
  end;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set provision_amount = greatest(0, provision_amount - v_expense.amount),
        current_period_spending = current_period_spending + v_first_installment_amount,
        updated_at = now()
    where id = v_card.id;

    if v_expense.installment_count > 1 and not exists (
      select 1
      from public.card_installments
      where card_expense_id = v_expense.id
    ) then
      for v_installment_no in 1..v_expense.installment_count loop
        v_installment_amount := round(v_expense.amount / v_expense.installment_count, 2);
        if v_installment_no = v_expense.installment_count then
          v_installment_amount := v_expense.amount - (round(v_expense.amount / v_expense.installment_count, 2) * (v_expense.installment_count - 1));
        end if;

        v_due_month := (date_trunc('month', v_expense.spent_at)::date + ((v_installment_no - 1) * interval '1 month'))::date;

        insert into public.card_installments (
          user_id,
          card_id,
          card_expense_id,
          installment_no,
          installment_count,
          due_month,
          amount,
          description,
          category,
          status,
          posted_at
        )
        values (
          v_user_id,
          v_card.id,
          v_expense.id,
          v_installment_no,
          v_expense.installment_count,
          v_due_month,
          v_installment_amount,
          v_expense.description,
          v_expense.category,
          case when v_installment_no = 1 then 'posted' else 'scheduled' end,
          case when v_installment_no = 1 then now() else null end
        );
      end loop;
    end if;
  end if;

  update public.card_expenses
  set status = 'posted',
      posted_at = now(),
      updated_at = now()
  where id = v_expense.id
  returning * into v_posted_expense;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    v_expense.description || ' provizyonu kesinlesti',
    v_expense.amount,
    'card_expenses',
    v_expense.id,
    'Provizyon donem icine aktarildi.'
  );

  return v_posted_expense;
end;
$$;

grant execute on function public.post_card_provision(uuid) to authenticated;

create or replace function public.cancel_card_provision(
  p_expense_id uuid
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_cancelled_expense public.card_expenses%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Provizyon bulunamadi.';
  end if;

  if v_expense.status <> 'provision' then
    raise exception 'Bu islem provizyonda degil.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_expense.card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = greatest(0, debt_amount - v_expense.amount),
        provision_amount = greatest(0, provision_amount - v_expense.amount),
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance + v_expense.amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  delete from public.card_installments
  where card_expense_id = v_expense.id
    and user_id = v_user_id;

  update public.card_expenses
  set status = 'cancelled',
      posted_at = null,
      updated_at = now()
  where id = v_expense.id
  returning * into v_cancelled_expense;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    v_expense.description || ' provizyonu iptal edildi',
    v_expense.amount,
    'card_expenses',
    v_expense.id,
    'Provizyon limit veya bakiye etkisinden cikarildi.'
  );

  return v_cancelled_expense;
end;
$$;

grant execute on function public.cancel_card_provision(uuid) to authenticated;

create or replace function public.pay_card_debt(
  p_card_id uuid,
  p_source_card_id uuid,
  p_amount numeric
)
returns public.cards
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_paid_card public.cards%rowtype;
  v_payable_amount numeric(14, 2);
  v_remaining_payment numeric(14, 2);
  v_next_statement_debt numeric(14, 2);
  v_next_current_period numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Odeme tutari 0 dan buyuk olmali.';
  end if;

  if p_card_id = p_source_card_id then
    raise exception 'Kaynak hesap ve borc karti ayni olamaz.';
  end if;

  select *
  into v_source
  from public.cards
  where id = p_source_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kaynak hesap bulunamadi.';
  end if;

  if v_source.card_type <> 'banka_karti' then
    raise exception 'Kaynak hesap banka karti olmali.';
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

  v_payable_amount := greatest(0, v_card.debt_amount - v_card.provision_amount);

  if v_payable_amount <= 0 then
    raise exception 'Odenecek kesinlesmis kart borcu yok.';
  end if;

  if p_amount > v_payable_amount then
    raise exception 'Odeme tutari kesinlesmis kart borcundan buyuk olamaz.';
  end if;

  if v_source.current_balance < p_amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  v_remaining_payment := p_amount;
  v_next_statement_debt := greatest(0, v_card.statement_debt_amount - v_remaining_payment);
  v_remaining_payment := greatest(0, v_remaining_payment - v_card.statement_debt_amount);
  v_next_current_period := greatest(0, v_card.current_period_spending - v_remaining_payment);

  update public.cards
  set current_balance = current_balance - p_amount,
      updated_at = now()
  where id = v_source.id;

  update public.cards
  set debt_amount = debt_amount - p_amount,
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
    p_amount,
    'cards',
    v_card.id,
    v_source.card_name || ' hesabindan odendi.'
  );

  return v_paid_card;
end;
$$;

grant execute on function public.pay_card_debt(uuid, uuid, numeric) to authenticated;

create or replace function public.reset_user_finance_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  delete from public.dismissed_upcoming_items where user_id = v_user_id;
  delete from public.card_installments where user_id = v_user_id;
  delete from public.card_statement_archives where user_id = v_user_id;
  delete from public.card_expenses where user_id = v_user_id;
  delete from public.loan_installments where user_id = v_user_id;
  delete from public.transaction_history where user_id = v_user_id;
  delete from public.budgets where user_id = v_user_id;
  delete from public.savings_goals where user_id = v_user_id;
  delete from public.salary_history where user_id = v_user_id;
  delete from public.payments where user_id = v_user_id;
  delete from public.debts where user_id = v_user_id;
  delete from public.loans where user_id = v_user_id;
  delete from public.cards where user_id = v_user_id;
  delete from public.assets where user_id = v_user_id;
end;
$$;

grant execute on function public.reset_user_finance_data() to authenticated;
