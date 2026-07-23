-- pay_card_statement: ödeme sonrası açık arşiv kalmadıysa statement_debt_amount'ı
-- zorla sıfırlayıp current_period_spending'e aktar.
-- Kök neden: kart.statement_debt_amount ile arşiv.statement_debt_amount arasında
-- uyumsuzluk olduğunda ödeme tam sıfırlamıyordu.

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
  v_has_remaining_open boolean;
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

  -- Ödeme sonrası açık arşiv kalmadıysa orphan statement_debt'i temizle
  select exists(
    select 1 from public.card_statement_archives
    where card_id = v_card.id
      and user_id = v_user_id
      and status = 'open'
  ) into v_has_remaining_open;

  if not v_has_remaining_open then
    update public.cards
    set current_period_spending = current_period_spending + statement_debt_amount,
        statement_debt_amount = 0,
        updated_at = now()
    where id = v_card.id
      and statement_debt_amount > 0;
  end if;

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
revoke execute on function public.pay_card_statement(uuid, uuid) from public;
revoke execute on function public.pay_card_statement(uuid, uuid) from anon;
