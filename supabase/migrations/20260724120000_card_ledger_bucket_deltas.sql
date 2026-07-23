-- Card ledger bucket tracking (plan: "Kart Ledger Bucket Tracking").
--
-- The card_ledger currently records only the total debt delta (amount_kurus).
-- This migration adds per-bucket deltas so the breakdown (statement / current /
-- provision) becomes derivable from events — not just the total debt.
--
-- Three nullable bigint columns capture what changed in each bucket. Old events
-- keep NULL (unknown bucket). A new 'reclass' kind captures zero-debt-delta
-- bucket shifts (e.g. statement cut moves current → statement without changing
-- total debt).

-- 1. New columns -----------------------------------------------------------

alter table public.card_ledger
  add column if not exists statement_delta_kurus bigint,
  add column if not exists current_delta_kurus bigint,
  add column if not exists provision_delta_kurus bigint;

-- 2. Allow the 'reclass' kind ---------------------------------------------

alter table public.card_ledger drop constraint if exists card_ledger_kind_check;
alter table public.card_ledger
  add constraint card_ledger_kind_check
  check (kind in ('opening', 'debit', 'credit', 'adjustment', 'reclass'));

-- 3. Updated trigger: records bucket deltas alongside total delta ----------

create or replace function public.record_card_debt_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(14, 2);
  v_stmt_delta bigint;
  v_curr_delta bigint;
  v_prov_delta bigint;
  v_has_bucket_change boolean;
  v_kind text;
  v_note text;
begin
  if coalesce(current_setting('app.ledger_suppress', true), '') = '1' then
    return new;
  end if;

  if (tg_op = 'INSERT') then
    if new.card_type = 'kredi_karti' and coalesce(new.debt_amount, 0) <> 0 then
      insert into public.card_ledger (
        user_id, card_id, kind, amount_kurus,
        statement_delta_kurus, current_delta_kurus, provision_delta_kurus,
        note, source_table, source_id
      )
      values (
        new.user_id, new.id, 'opening', round(new.debt_amount * 100)::bigint,
        round(coalesce(new.statement_debt_amount, 0) * 100)::bigint,
        round(coalesce(new.current_period_spending, 0) * 100)::bigint,
        round(coalesce(new.provision_amount, 0) * 100)::bigint,
        'Kart açılış borcu', 'cards', new.id
      );
    end if;
    return new;
  end if;

  -- UPDATE
  if new.card_type = 'kredi_karti' then
    v_delta := coalesce(new.debt_amount, 0) - coalesce(old.debt_amount, 0);
    v_stmt_delta := round((coalesce(new.statement_debt_amount, 0) - coalesce(old.statement_debt_amount, 0)) * 100)::bigint;
    v_curr_delta := round((coalesce(new.current_period_spending, 0) - coalesce(old.current_period_spending, 0)) * 100)::bigint;
    v_prov_delta := round((coalesce(new.provision_amount, 0) - coalesce(old.provision_amount, 0)) * 100)::bigint;
    v_has_bucket_change := (v_stmt_delta <> 0 or v_curr_delta <> 0 or v_prov_delta <> 0);

    if v_delta <> 0 or v_has_bucket_change then
      if coalesce(current_setting('app.ledger_kind', true), '') = 'adjustment' then
        v_kind := 'adjustment';
        v_note := coalesce(nullif(current_setting('app.ledger_note', true), ''), 'Manuel düzeltme');
      elsif v_delta = 0 then
        v_kind := 'reclass';
        v_note := 'Borç kırılımı değişikliği';
      elsif v_delta > 0 then
        v_kind := 'debit';
        v_note := 'Borç değişimi (otomatik kayıt)';
      else
        v_kind := 'credit';
        v_note := 'Borç değişimi (otomatik kayıt)';
      end if;

      insert into public.card_ledger (
        user_id, card_id, kind, amount_kurus,
        statement_delta_kurus, current_delta_kurus, provision_delta_kurus,
        note, source_table, source_id
      )
      values (
        new.user_id, new.id, v_kind, round(v_delta * 100)::bigint,
        v_stmt_delta, v_curr_delta, v_prov_delta,
        v_note, 'cards', new.id
      );
    end if;
  end if;

  return new;
end;
$$;

-- 4. Updated recompute RPC: uses bucket projection when available ----------

create or replace function public.recompute_card_debt_from_ledger(p_card_id uuid)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_projection numeric(14, 2);
  v_all_have_buckets boolean;
  v_stmt_proj numeric(14, 2);
  v_curr_proj numeric(14, 2);
  v_prov_proj numeric(14, 2);
  v_delta numeric(14, 2);
  v_remaining numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Sadece kredi kartı borcu yeniden hesaplanabilir.';
  end if;

  select coalesce(sum(amount_kurus), 0) / 100.0
  into v_projection
  from public.card_ledger
  where card_id = p_card_id;

  select count(*) filter (where statement_delta_kurus is null) = 0
  into v_all_have_buckets
  from public.card_ledger
  where card_id = p_card_id;

  perform set_config('app.ledger_suppress', '1', true);

  if v_all_have_buckets then
    select coalesce(sum(statement_delta_kurus), 0) / 100.0,
           coalesce(sum(current_delta_kurus), 0) / 100.0,
           coalesce(sum(provision_delta_kurus), 0) / 100.0
    into v_stmt_proj, v_curr_proj, v_prov_proj
    from public.card_ledger
    where card_id = p_card_id;

    -- Clamp: same priority as clamp_card_breakdown trigger
    v_stmt_proj := least(greatest(0, v_stmt_proj), greatest(0, v_projection));
    v_prov_proj := least(greatest(0, v_prov_proj), greatest(0, v_projection - v_stmt_proj));
    v_curr_proj := least(greatest(0, v_curr_proj), greatest(0, v_projection - v_stmt_proj - v_prov_proj));

    update public.cards
    set debt_amount = v_projection,
        statement_debt_amount = v_stmt_proj,
        current_period_spending = v_curr_proj,
        provision_amount = v_prov_proj,
        updated_at = now()
    where id = p_card_id;
  else
    -- Fallback: heuristic (current first, then statement, then provision)
    v_delta := v_projection - coalesce(v_card.debt_amount, 0);
    v_remaining := greatest(0, -v_delta);

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
  end if;

  return v_projection;
end;
$$;

grant execute on function public.recompute_card_debt_from_ledger(uuid) to authenticated;
