-- Card ledger: verifiable projection + reverse-entry corrections (roadmap A2.1).
--
-- A2 made `card_ledger` an append-only, exact (integer-kuruş) trail derived from
-- `cards.debt_amount` via an AFTER trigger, so sum(amount_kurus) always equals
-- round(debt_amount*100). This migration turns the ledger into the *authority*
-- without rewiring any of the ~15 debt RPCs:
--
--  1. Repair: `recompute_card_debt_from_ledger` pulls `debt_amount` back to the
--     ledger projection (used when an out-of-band write caused drift).
--  2. Correction: `post_card_debt_correction` applies a signed adjustment that
--     lands as an auditable `kind='adjustment'` event carrying a reason note,
--     instead of a silent debt_amount overwrite.
--
-- Both steer the existing trigger through transaction-local GUCs (set_config
-- with is_local=true), so the trigger stays the single writer of ledger events:
--   * app.ledger_suppress='1' -> trigger writes nothing (repair sets
--     debt_amount=projection without double-counting the delta).
--   * app.ledger_kind='adjustment' + app.ledger_note=<reason> -> the UPDATE event
--     is labelled 'adjustment' with the note instead of debit/credit.

-- Allow the new 'adjustment' kind. The inline check from the create-table
-- migration is auto-named card_ledger_kind_check.
alter table public.card_ledger drop constraint if exists card_ledger_kind_check;
alter table public.card_ledger
  add constraint card_ledger_kind_check
  check (kind in ('opening', 'debit', 'credit', 'adjustment'));

-- Trigger: same behaviour as before, plus GUC steering. current_setting/​
-- set_config are pg_catalog built-ins, reachable even with empty search_path.
create or replace function public.record_card_debt_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(14, 2);
  v_kind text;
  v_note text;
begin
  -- Repair path: a controlled write asked us to stay silent (debt is being set
  -- straight to the projection, so emitting a delta event would double-count).
  if coalesce(current_setting('app.ledger_suppress', true), '') = '1' then
    return new;
  end if;

  if (tg_op = 'INSERT') then
    if new.card_type = 'kredi_karti' and coalesce(new.debt_amount, 0) <> 0 then
      insert into public.card_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id)
      values (new.user_id, new.id, 'opening', round(new.debt_amount * 100)::bigint,
              'Kart açılış borcu', 'cards', new.id);
    end if;
    return new;
  end if;

  -- UPDATE
  if new.card_type = 'kredi_karti' then
    v_delta := coalesce(new.debt_amount, 0) - coalesce(old.debt_amount, 0);
    if v_delta <> 0 then
      -- An explicit correction labels the event 'adjustment' and carries a reason.
      if coalesce(current_setting('app.ledger_kind', true), '') = 'adjustment' then
        v_kind := 'adjustment';
        v_note := coalesce(nullif(current_setting('app.ledger_note', true), ''), 'Manuel düzeltme');
      else
        v_kind := case when v_delta > 0 then 'debit' else 'credit' end;
        v_note := 'Borç değişimi (otomatik kayıt)';
      end if;

      insert into public.card_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id)
      values (new.user_id, new.id, v_kind, round(v_delta * 100)::bigint, v_note, 'cards', new.id);
    end if;
  end if;

  return new;
end;
$$;

-- Repair: reset a credit card's debt to the exact ledger projection. Runs as the
-- caller (security invoker, like pay_card_debt); RLS + the user_id filter scope
-- it to the owner. Suppresses the trigger for its own write so no delta event is
-- recorded for the correction itself.
create or replace function public.recompute_card_debt_from_ledger(p_card_id uuid)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_projection numeric(14, 2);
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

  perform set_config('app.ledger_suppress', '1', true);

  update public.cards
  set debt_amount = v_projection,
      updated_at = now()
  where id = p_card_id;

  return v_projection;
end;
$$;

grant execute on function public.recompute_card_debt_from_ledger(uuid) to authenticated;

-- Correction: apply a signed adjustment (integer kuruş, +debit / -credit) to a
-- credit card's debt as an auditable 'adjustment' ledger event with a reason.
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

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', btrim(p_note), true);

  update public.cards
  set debt_amount = v_new_debt,
      updated_at = now()
  where id = p_card_id;

  return v_new_debt;
end;
$$;

grant execute on function public.post_card_debt_correction(uuid, bigint, text) to authenticated;
