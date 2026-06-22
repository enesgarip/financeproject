-- Card debt correction ("ters kayıt") should carry the breakdown down with the
-- total when it *reduces* debt.
--
-- Bug: `post_card_debt_correction` (the card-detail "Düzelt (ters kayıt)" action)
-- only wrote `debt_amount`. When the user reversed a cancelled transaction the
-- total debt dropped, but `current_period_spending` ("Dönem borcu") stayed put.
-- The `clamp_card_breakdown` BEFORE trigger only normalises when split > debt, so
-- as long as the lowered total still covered the old split, the stale dönem borcu
-- survived — exactly the reported symptom.
--
-- Fix: when a correction reduces debt, peel the reduction off the visible split
-- using the same priority `clamp_card_breakdown` uses (statement most protected),
-- i.e. current period first, then provision, then statement. An *increase*
-- correction still leaves the split untouched; the extra debt stays unallocated
-- until a real transaction posts into a bucket.
--
-- Only the breakdown columns are added; `debt_amount` math is unchanged, so the
-- A2.1 ledger AFTER trigger still records the same single 'adjustment' delta.

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
  v_new_debt numeric(14, 2);
  v_reduction numeric(14, 2);
  v_take numeric(14, 2);
  v_current numeric(14, 2);
  v_provision numeric(14, 2);
  v_statement numeric(14, 2);
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

  v_new_debt := coalesce(v_card.debt_amount, 0) + p_amount_kurus / 100.0;
  if v_new_debt < 0 then
    raise exception 'Duzeltme sonrasi borc negatif olamaz.';
  end if;

  -- Carry the breakdown down with the total only when the correction reduces
  -- debt. Peel current period first, then provision, then statement — the same
  -- priority clamp_card_breakdown protects with (statement last to be cut).
  v_current := greatest(0, coalesce(v_card.current_period_spending, 0));
  v_provision := greatest(0, coalesce(v_card.provision_amount, 0));
  v_statement := greatest(0, coalesce(v_card.statement_debt_amount, 0));

  v_reduction := greatest(0, coalesce(v_card.debt_amount, 0) - v_new_debt);

  v_take := least(v_reduction, v_current);
  v_current := v_current - v_take;
  v_reduction := v_reduction - v_take;

  v_take := least(v_reduction, v_provision);
  v_provision := v_provision - v_take;
  v_reduction := v_reduction - v_take;

  v_take := least(v_reduction, v_statement);
  v_statement := v_statement - v_take;
  v_reduction := v_reduction - v_take;

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', btrim(p_note), true);

  update public.cards
  set debt_amount = v_new_debt,
      current_period_spending = v_current,
      provision_amount = v_provision,
      statement_debt_amount = v_statement,
      updated_at = now()
  where id = p_card_id;

  return v_new_debt;
end;
$$;

grant execute on function public.post_card_debt_correction(uuid, bigint, text) to authenticated;
