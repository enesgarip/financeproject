create or replace function public.add_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default current_date,
  p_installment_count integer default 1,
  p_category text default 'Diğer'
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
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount <= 0 then
    raise exception 'Harcama tutari 0 dan buyuk olmali.';
  end if;

  if trim(coalesce(p_description, '')) = '' then
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
        current_period_spending = current_period_spending + v_first_installment_amount,
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
    installment_amount
  )
  values (
    v_user_id,
    p_card_id,
    p_spent_at,
    p_amount,
    trim(p_description),
    coalesce(nullif(trim(coalesce(p_category, '')), ''), 'Diğer'),
    v_installment_count,
    v_first_installment_amount
  )
  returning * into v_expense;

  if v_installment_count > 1 then
    for v_installment_no in 1..v_installment_count loop
      v_installment_amount := round(p_amount / v_installment_count, 2);
      if v_installment_no = v_installment_count then
        v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
      end if;

      v_due_month := (date_trunc('month', p_spent_at)::date + ((v_installment_no - 1) * interval '1 month'))::date;

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
        trim(p_description),
        coalesce(nullif(trim(coalesce(p_category, '')), ''), 'Diğer'),
        case when v_installment_no = 1 then 'posted' else 'scheduled' end,
        case when v_installment_no = 1 then now() else null end
      );
    end loop;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    trim(p_description),
    p_amount,
    'card_expenses',
    v_expense.id,
    case
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcamasi.'
      else 'Peşin kart harcaması.'
    end
  );

  return v_expense;
end;
$$;

grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text) to authenticated;
