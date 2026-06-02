create or replace function public.transfer_between_accounts(
  p_source_card_id uuid,
  p_target_card_id uuid,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_source public.cards%rowtype;
  v_target public.cards%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if v_amount <= 0 then
    raise exception 'Transfer tutari 0 dan buyuk olmali.';
  end if;

  if p_source_card_id = p_target_card_id then
    raise exception 'Kaynak ve hedef hesap ayni olamaz.';
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
  into v_target
  from public.cards
  where id = p_target_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Hedef hesap bulunamadi.';
  end if;

  if v_target.card_type <> 'banka_karti' then
    raise exception 'Hedef hesap banka karti olmali.';
  end if;

  if v_source.current_balance < v_amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance - v_amount,
      updated_at = now()
  where id = v_source.id
  returning * into v_source;

  update public.cards
  set current_balance = current_balance + v_amount,
      updated_at = now()
  where id = v_target.id
  returning * into v_target;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
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

drop function if exists public.pay_card_installment(uuid);
drop function if exists public.pay_card_installment(uuid, uuid);

create or replace function public.pay_card_installment(
  p_installment_id uuid,
  p_source_card_id uuid
)
returns public.card_installments
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_installment public.card_installments%rowtype;
  v_paid_installment public.card_installments%rowtype;
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_remaining_payment numeric(14, 2);
  v_next_statement_debt numeric(14, 2);
  v_next_current_period numeric(14, 2);
  v_current_month_start date := date_trunc('month', current_date)::date;
  v_installment_month_start date;
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

  if v_installment.status = 'paid' then
    raise exception 'Taksit zaten odendi.';
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
    raise exception 'Taksit odemesi sadece kredi karti icin kullanilabilir.';
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

  if v_installment.status = 'scheduled' then
    update public.cards
    set debt_amount = greatest(0, debt_amount - v_installment.amount),
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

    v_remaining_payment := v_installment.amount;

    if v_statemented then
      v_next_statement_debt := greatest(0, v_card.statement_debt_amount - v_remaining_payment);
      v_remaining_payment := greatest(0, v_remaining_payment - v_card.statement_debt_amount);
      v_next_current_period := greatest(0, v_card.current_period_spending - v_remaining_payment);
    else
      v_next_current_period := greatest(0, v_card.current_period_spending - v_remaining_payment);
      v_remaining_payment := greatest(0, v_remaining_payment - v_card.current_period_spending);
      v_next_statement_debt := greatest(0, v_card.statement_debt_amount - v_remaining_payment);
    end if;

    update public.cards
    set debt_amount = greatest(0, debt_amount - v_installment.amount),
        statement_debt_amount = v_next_statement_debt,
        current_period_spending = v_next_current_period,
        updated_at = now()
    where id = v_card.id;
  end if;

  update public.card_installments
  set status = 'paid',
      paid_at = now(),
      updated_at = now()
  where id = v_installment.id
  returning * into v_paid_installment;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_installment.description || ' taksiti odendi',
    v_installment.amount,
    'card_installments',
    v_installment.id,
    v_source.card_name || ' hesabindan odendi.'
  );

  return v_paid_installment;
end;
$$;

grant execute on function public.pay_card_installment(uuid, uuid) to authenticated;
