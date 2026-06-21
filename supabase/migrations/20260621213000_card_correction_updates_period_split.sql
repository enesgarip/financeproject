-- Card ledger corrections must keep the visible debt split in sync with the
-- audited total debt. A negative reverse-entry from the card detail screen is
-- normally a cancelled/removed transaction, so it should reduce the current
-- period bucket first instead of only lowering cards.debt_amount.

create or replace function public.recompute_card_debt_from_ledger(p_card_id uuid)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_projection numeric(14, 2);
  v_delta numeric(14, 2);
  v_remaining numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
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

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Sadece kredi karti borcu yeniden hesaplanabilir.';
  end if;

  select coalesce(sum(amount_kurus), 0) / 100.0
  into v_projection
  from public.card_ledger
  where card_id = p_card_id;

  v_delta := v_projection - coalesce(v_card.debt_amount, 0);
  v_remaining := greatest(0, -v_delta);

  perform set_config('app.ledger_suppress', '1', true);

  update public.cards
  set debt_amount = v_projection,
      current_period_spending = case
        when v_delta < 0 then greatest(0, current_period_spending - v_remaining)
        else current_period_spending
      end,
      statement_debt_amount = case
        when v_delta < 0 then greatest(0, statement_debt_amount - greatest(0, v_remaining - current_period_spending))
        else statement_debt_amount
      end,
      provision_amount = case
        when v_delta < 0 then greatest(0, provision_amount - greatest(0, v_remaining - current_period_spending - statement_debt_amount))
        else provision_amount
      end,
      updated_at = now()
  where id = p_card_id;

  return v_projection;
end;
$$;

grant execute on function public.recompute_card_debt_from_ledger(uuid) to authenticated;

create or replace function public.post_card_debt_correction(
  p_card_id uuid,
  p_amount_kurus bigint,
  p_note text
)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_delta numeric(14, 2);
  v_new_debt numeric(14, 2);
  v_remaining numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount_kurus is null or p_amount_kurus = 0 then
    raise exception 'Duzeltme tutari 0 olamaz.';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'Duzeltme icin bir sebep girilmeli.';
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

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Sadece kredi karti borcu duzeltilebilir.';
  end if;

  v_delta := p_amount_kurus / 100.0;
  v_new_debt := coalesce(v_card.debt_amount, 0) + v_delta;
  if v_new_debt < 0 then
    raise exception 'Duzeltme sonrasi borc negatif olamaz.';
  end if;

  v_remaining := greatest(0, -v_delta);

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', btrim(p_note), true);

  update public.cards
  set debt_amount = v_new_debt,
      current_period_spending = case
        when v_delta < 0 then greatest(0, current_period_spending - v_remaining)
        when v_delta > 0 then current_period_spending + v_delta
        else current_period_spending
      end,
      statement_debt_amount = case
        when v_delta < 0 then greatest(0, statement_debt_amount - greatest(0, v_remaining - current_period_spending))
        else statement_debt_amount
      end,
      provision_amount = case
        when v_delta < 0 then greatest(0, provision_amount - greatest(0, v_remaining - current_period_spending - statement_debt_amount))
        else provision_amount
      end,
      updated_at = now()
  where id = p_card_id;

  return v_new_debt;
end;
$$;

grant execute on function public.post_card_debt_correction(uuid, bigint, text) to authenticated;
