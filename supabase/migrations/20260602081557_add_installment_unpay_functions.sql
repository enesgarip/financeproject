create or replace function public.unpay_card_installment(
  p_installment_id uuid
)
returns public.card_installments
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_installment public.card_installments%rowtype;
  v_unpaid_installment public.card_installments%rowtype;
  v_card public.cards%rowtype;
  v_target_status text;
  v_installment_month_start date;
  v_current_month_start date := date_trunc('month', current_date)::date;
  v_statemented boolean := false;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_installment
  from public.card_installments
  where id = p_installment_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Taksit bulunamadi.';
  end if;

  if v_installment.status <> 'paid' then
    raise exception 'Sadece odenmis taksit geri alinabilir.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_installment.card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Taksit geri alma sadece kredi karti icin kullanilabilir.';
  end if;

  v_target_status := case when v_installment.posted_at is null then 'scheduled' else 'posted' end;

  if v_target_status = 'scheduled' then
    update public.cards
    set debt_amount = debt_amount + v_installment.amount,
        updated_at = now()
    where id = v_card.id;
  else
    v_installment_month_start := date_trunc('month', v_installment.due_month)::date;
    v_statemented := v_installment_month_start < v_current_month_start
      or (
        v_installment_month_start = v_current_month_start
        and v_card.statement_day is not null
        and extract(day from current_date)::integer >= v_card.statement_day
      );

    update public.cards
    set debt_amount = debt_amount + v_installment.amount,
        statement_debt_amount = statement_debt_amount + case when v_statemented then v_installment.amount else 0 end,
        current_period_spending = current_period_spending + case when v_statemented then 0 else v_installment.amount end,
        updated_at = now()
    where id = v_card.id;
  end if;

  update public.card_installments
  set status = v_target_status,
      paid_at = null,
      updated_at = now()
  where id = v_installment.id
  returning * into v_unpaid_installment;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_installment.description || ' taksit odemesi geri alindi',
    v_installment.amount,
    'card_installments',
    v_installment.id,
    case
      when v_target_status = 'scheduled' then 'Gelecek taksit tekrar planli duruma alindi.'
      else 'Kart taksiti tekrar donem borcuna alindi.'
    end
  );

  return v_unpaid_installment;
end;
$$;

grant execute on function public.unpay_card_installment(uuid) to authenticated;

create or replace function public.unpay_loan_installment(
  p_installment_id uuid
)
returns public.loan_installments
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_installment public.loan_installments%rowtype;
  v_unpaid_installment public.loan_installments%rowtype;
  v_loan public.loans%rowtype;
  v_remaining_amount numeric(14, 2);
  v_remaining_installments integer;
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

  if v_installment.status <> 'ödendi' then
    raise exception 'Sadece odenmis taksit geri alinabilir.';
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

  update public.loan_installments
  set status = 'bekliyor',
      paid_at = null,
      updated_at = now()
  where id = v_installment.id
  returning * into v_unpaid_installment;

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
    v_loan.loan_name || ' ' || v_installment.installment_no || '. taksit odemesi geri alindi',
    v_installment.amount,
    'loan_installments',
    v_installment.id,
    'Taksit bekliyor durumuna geri alindi. Kaynak hesaba otomatik iade yapilmaz.'
  );

  return v_unpaid_installment;
end;
$$;

grant execute on function public.unpay_loan_installment(uuid) to authenticated;
