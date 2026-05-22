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

  if v_card.debt_amount <= 0 then
    raise exception 'Odenecek kart borcu yok.';
  end if;

  if p_amount > v_card.debt_amount then
    raise exception 'Odeme tutari guncel borctan buyuk olamaz.';
  end if;

  if v_source.current_balance < p_amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance - p_amount,
      updated_at = now()
  where id = v_source.id;

  update public.cards
  set debt_amount = debt_amount - p_amount,
      statement_debt_amount = greatest(0, statement_debt_amount - p_amount),
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

create or replace function public.pay_loan_installment(
  p_installment_id uuid,
  p_source_card_id uuid
)
returns public.loan_installments
language plpgsql
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

  if v_source.current_balance < v_installment.amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance - v_installment.amount,
      updated_at = now()
  where id = v_source.id;

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
