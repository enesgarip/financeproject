-- Account ledger: verifiable projection + reverse-entry corrections (Faz 3.1).
--
-- Mirrors the card-ledger A2.1 work for bank accounts. Faz 3 made
-- `account_ledger` an append-only exact trail derived from `cards.current_balance`
-- via an AFTER trigger. This makes the ledger the *authority* without rewiring
-- any balance write:
--   1. Repair: `recompute_account_balance_from_ledger` pulls current_balance back
--      to the ledger projection (used when an out-of-band write caused drift).
--   2. Correction: `post_account_balance_correction` applies a signed adjustment
--      that lands as an auditable `kind='adjustment'` event with a reason note.
--
-- Both steer the existing trigger through transaction-local GUCs (set_config,
-- is_local=true), reusing the same names as the card-ledger trigger. This is
-- safe because the two triggers act on disjoint card types (banka_karti vs
-- kredi_karti), so only one ever fires for a given row:
--   * app.ledger_suppress='1' -> trigger writes nothing (repair).
--   * app.ledger_kind='adjustment' + app.ledger_note=<reason> -> the UPDATE event
--     is labelled 'adjustment' with the note instead of deposit/withdrawal.

alter table public.account_ledger drop constraint if exists account_ledger_kind_check;
alter table public.account_ledger
  add constraint account_ledger_kind_check
  check (kind in ('opening', 'deposit', 'withdrawal', 'adjustment'));

create or replace function public.record_account_balance_event()
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
  if coalesce(current_setting('app.ledger_suppress', true), '') = '1' then
    return new;
  end if;

  if (tg_op = 'INSERT') then
    if new.card_type = 'banka_karti' and coalesce(new.current_balance, 0) <> 0 then
      insert into public.account_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id)
      values (new.user_id, new.id, 'opening', round(new.current_balance * 100)::bigint,
              'Hesap açılış bakiyesi', 'cards', new.id);
    end if;
    return new;
  end if;

  -- UPDATE
  if new.card_type = 'banka_karti' then
    v_delta := coalesce(new.current_balance, 0) - coalesce(old.current_balance, 0);
    if v_delta <> 0 then
      if coalesce(current_setting('app.ledger_kind', true), '') = 'adjustment' then
        v_kind := 'adjustment';
        v_note := coalesce(nullif(current_setting('app.ledger_note', true), ''), 'Manuel düzeltme');
      else
        v_kind := case when v_delta > 0 then 'deposit' else 'withdrawal' end;
        v_note := 'Bakiye değişimi (otomatik kayıt)';
      end if;

      insert into public.account_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id)
      values (new.user_id, new.id, v_kind, round(v_delta * 100)::bigint, v_note, 'cards', new.id);
    end if;
  end if;

  return new;
end;
$$;

-- Repair: reset a bank account's balance to the exact ledger projection.
create or replace function public.recompute_account_balance_from_ledger(p_card_id uuid)
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
  where id = p_card_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Hesap bulunamadi.';
  end if;

  if v_card.card_type <> 'banka_karti' then
    raise exception 'Sadece banka hesabi bakiyesi yeniden hesaplanabilir.';
  end if;

  select coalesce(sum(amount_kurus), 0) / 100.0
  into v_projection
  from public.account_ledger
  where card_id = p_card_id;

  perform set_config('app.ledger_suppress', '1', true);

  update public.cards
  set current_balance = v_projection,
      updated_at = now()
  where id = p_card_id;

  return v_projection;
end;
$$;

grant execute on function public.recompute_account_balance_from_ledger(uuid) to authenticated;

-- Correction: apply a signed adjustment (integer kuruş, +deposit / -withdrawal)
-- to a bank account's balance as an auditable 'adjustment' ledger event.
create or replace function public.post_account_balance_correction(
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
  v_new_balance numeric(14, 2);
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
  where id = p_card_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Hesap bulunamadi.';
  end if;

  if v_card.card_type <> 'banka_karti' then
    raise exception 'Sadece banka hesabi bakiyesi duzeltilebilir.';
  end if;

  v_new_balance := coalesce(v_card.current_balance, 0) + p_amount_kurus / 100.0;
  if v_new_balance < 0 then
    raise exception 'Duzeltme sonrasi bakiye negatif olamaz.';
  end if;

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', btrim(p_note), true);

  update public.cards
  set current_balance = v_new_balance,
      updated_at = now()
  where id = p_card_id;

  return v_new_balance;
end;
$$;

grant execute on function public.post_account_balance_correction(uuid, bigint, text) to authenticated;
