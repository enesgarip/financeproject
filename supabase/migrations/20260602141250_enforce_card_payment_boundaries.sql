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

  v_payable_amount := greatest(0, v_card.statement_debt_amount + v_card.current_period_spending);

  if v_payable_amount <= 0 then
    raise exception 'Odenecek kesinlesmis kart borcu yok.';
  end if;

  if v_amount > v_payable_amount + 0.01 then
    raise exception 'Odeme tutari ekstre ve donem ici kesinlesmis kart borcundan buyuk olamaz.';
  end if;

  if v_source.current_balance < v_amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  v_remaining_payment := v_amount;
  v_next_statement_debt := greatest(0, v_card.statement_debt_amount - v_remaining_payment);
  v_remaining_payment := greatest(0, v_remaining_payment - v_card.statement_debt_amount);
  v_next_current_period := greatest(0, v_card.current_period_spending - v_remaining_payment);

  update public.cards
  set current_balance = current_balance - v_amount,
      updated_at = now()
  where id = v_source.id;

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

create or replace function public.pay_card_statement(
  p_statement_id uuid,
  p_source_card_id uuid
)
returns public.card_statement_archives
language plpgsql
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

  v_payment_amount := round(greatest(0, v_statement.statement_debt_amount), 2);

  if v_payment_amount <= 0 then
    raise exception 'Ekstre tutari 0 oldugu icin odeme yapilamaz.';
  end if;

  if v_card.statement_debt_amount + 0.01 < v_payment_amount or v_card.debt_amount + 0.01 < v_payment_amount then
    raise exception 'Kart borcu ekstre tutariyla uyusmuyor. Veri sagligi kontrolunu calistir.';
  end if;

  if v_source.current_balance < v_payment_amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance - v_payment_amount,
      updated_at = now()
  where id = v_source.id;

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
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  perform p_source_card_id;

  if not exists (
    select 1
    from public.card_installments
    where id = p_installment_id
      and user_id = v_user_id
  ) then
    raise exception 'Taksit bulunamadi.';
  end if;

  raise exception 'Kredi karti taksitleri manuel odenmez; bagli kredi karti ekstresini ode.';
end;
$$;

grant execute on function public.pay_card_installment(uuid, uuid) to authenticated;

create or replace function public.unpay_card_installment(
  p_installment_id uuid
)
returns public.card_installments
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if not exists (
    select 1
    from public.card_installments
    where id = p_installment_id
      and user_id = v_user_id
  ) then
    raise exception 'Taksit bulunamadi.';
  end if;

  raise exception 'Kredi karti taksit durumu ekstre akisi disinda manuel geri alinmaz.';
end;
$$;

grant execute on function public.unpay_card_installment(uuid) to authenticated;
