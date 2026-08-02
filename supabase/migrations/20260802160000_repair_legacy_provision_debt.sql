-- INC-01 follow-up: safely repair active provisions created while provisions
-- were excluded from cards.debt_amount (20260625 .. 20260802130000).
--
-- A row is repaired only when all three independent projections agree:
--   1. active provision rows exactly project cards.provision_amount,
--   2. visible split + scheduled installments exceed total debt,
--   3. that excess is exactly the active provision amount.
-- This deliberately leaves ambiguous cards untouched. Updating debt_amount
-- fires the append-only card ledger trigger; the transaction-local settings
-- make that event an auditable adjustment instead of an opaque automatic debit.

do $$
declare
  v_candidate record;
  v_card public.cards%rowtype;
  v_active_provision numeric(14, 2);
  v_scheduled numeric(14, 2);
  v_repair_amount numeric(14, 2);
  v_reason text := 'Eski provizyon modelinden kalan toplam borç farkı (20260802160000)';
begin
  for v_candidate in
    select id
    from public.cards
    where card_type = 'kredi_karti'
      and round(provision_amount, 2) > 0
    order by id
  loop
    -- Aggregate projections are recomputed only after the owning card is
    -- locked. A concurrent finance RPC therefore cannot make a stale
    -- candidate pass while this one-time repair waits for its lock.
    select *
    into v_card
    from public.cards
    where id = v_candidate.id
    for update;

    select round(coalesce(sum(amount), 0), 2)
    into v_active_provision
    from public.card_expenses
    where user_id = v_card.user_id
      and card_id = v_card.id
      and status = 'provision';

    select round(coalesce(sum(amount), 0), 2)
    into v_scheduled
    from public.card_installments
    where user_id = v_card.user_id
      and card_id = v_card.id
      and status = 'scheduled';

    v_repair_amount := round(v_card.provision_amount, 2);
    if v_repair_amount <= 0
      or v_active_provision <> v_repair_amount
      or round(
        v_card.statement_debt_amount
        + v_card.current_period_spending
        + v_card.provision_amount
        + v_scheduled
        - v_card.debt_amount,
        2
      ) <> v_repair_amount
    then
      continue;
    end if;

    perform set_config('app.ledger_kind', 'adjustment', true);
    perform set_config('app.ledger_note', v_reason, true);

    update public.cards
    set debt_amount = debt_amount + v_repair_amount,
        updated_at = now()
    where id = v_card.id
      and user_id = v_card.user_id;

    insert into public.transaction_history (
      user_id,
      type,
      title,
      amount,
      source_table,
      source_id,
      note
    )
    values (
      v_card.user_id,
      'correction',
      v_card.card_name || ' provizyon borç düzeltmesi',
      v_repair_amount,
      'cards',
      v_card.id,
      v_reason || '. Provizyon ve dönem kovaları değiştirilmeden yalnız toplam borç tamamlandı.'
    );
  end loop;

  perform set_config('app.ledger_kind', '', true);
  perform set_config('app.ledger_note', '', true);
end;
$$;
