alter table public.card_installments
add column if not exists paid_at timestamptz;

update public.card_installments
set paid_at = null
where status <> 'paid'
  and paid_at is not null;

alter table public.card_installments
drop constraint if exists card_installments_status_check;

alter table public.card_installments
add constraint card_installments_status_check
check (status in ('scheduled', 'posted', 'paid'));

drop function if exists public.pay_card_installment(uuid);

create or replace function public.pay_card_installment(
  p_installment_id uuid
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
    case
      when v_installment.status = 'scheduled' then 'Gelecek taksit manuel olarak odendi isaretlendi.'
      else 'Kart taksiti manuel olarak odendi isaretlendi.'
    end
  );

  return v_paid_installment;
end;
$$;

grant execute on function public.pay_card_installment(uuid) to authenticated;
