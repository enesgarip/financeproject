alter table public.savings_goals
add column if not exists value_type text not null default 'TRY',
add column if not exists estimated_value_try numeric(14, 2) check (estimated_value_try is null or estimated_value_try >= 0);

update public.savings_goals
set value_type = 'TRY'
where value_type is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'savings_goals_value_type_check'
      and conrelid = 'public.savings_goals'::regclass
  ) then
    alter table public.savings_goals
    add constraint savings_goals_value_type_check
    check (value_type in ('TRY', 'gram_altin', 'ceyrek_altin'));
  end if;
end $$;

create or replace function public.update_card_expense(
  p_expense_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default null,
  p_installment_count integer default null,
  p_category text default null,
  p_note text default null
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_expense public.card_expenses%rowtype;
  v_card public.cards%rowtype;
  v_installment_count integer;
  v_installment_no integer;
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_spent_at date;
  v_category text;
  v_posted_period_amount numeric(14, 2) := 0;
  v_paid_before integer := 0;
  v_start_installment_no integer := 1;
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
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Harcama bulunamadi.';
  end if;

  if v_expense.status <> 'posted' then
    raise exception 'Sadece kesinlesmis harcamalar duzenlenebilir.';
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

  v_installment_count := greatest(1, least(coalesce(p_installment_count, v_expense.installment_count), 36));
  v_spent_at := coalesce(p_spent_at, v_expense.spent_at);
  v_category := coalesce(nullif(btrim(coalesce(p_category, '')), ''), v_expense.category);

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

  if v_expense.note ~ '^[0-9]+/[0-9]+ taksiti uygulama oncesinde odendi\.$' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksiti uygulama oncesinde odendi\.$'))[1]::integer
    ));
    v_start_installment_no := v_paid_before + 1;
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_card.card_type = 'kredi_karti' then
    select coalesce(sum(amount), 0)
    into v_posted_period_amount
    from public.card_installments
    where card_expense_id = v_expense.id
      and status = 'posted';

    if v_posted_period_amount = 0 then
      v_posted_period_amount := case
        when v_expense.installment_count <= 1 then v_expense.amount
        else v_expense.installment_amount
      end;
    end if;

    update public.cards
    set debt_amount = greatest(0, debt_amount - v_expense.amount),
        current_period_spending = greatest(0, current_period_spending - v_posted_period_amount),
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance + v_expense.amount,
        updated_at = now()
    where id = v_card.id;

    if v_card.current_balance < p_amount then
      raise exception 'Banka karti bakiyesi yetersiz.';
    end if;
  end if;

  delete from public.card_installments
  where card_expense_id = v_expense.id;

  update public.card_expenses
  set spent_at = v_spent_at,
      amount = p_amount,
      description = btrim(coalesce(p_description, '')),
      category = v_category,
      installment_count = v_installment_count,
      installment_amount = v_first_installment_amount,
      note = coalesce(p_note, v_expense.note),
      updated_at = now()
  where id = v_expense.id
  returning * into v_expense;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + case
          when v_installment_count = 1 then p_amount
          else v_first_installment_amount
        end,
        updated_at = now()
    where id = v_card.id;

    if v_installment_count > 1 then
      for v_installment_no in v_start_installment_no..v_installment_count loop
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
          v_card.id,
          v_expense.id,
          v_installment_no,
          v_installment_count,
          v_due_month,
          v_installment_amount,
          btrim(coalesce(p_description, '')),
          v_category,
          case when v_installment_no = v_start_installment_no then 'posted' else 'scheduled' end,
          case when v_installment_no = v_start_installment_no then now() else null end
        );
      end loop;
    end if;
  else
    update public.cards
    set current_balance = current_balance - p_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  return v_expense;
end;
$$;

grant execute on function public.update_card_expense(uuid, numeric, text, date, integer, text, text) to authenticated;
