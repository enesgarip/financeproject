-- Card debt breakdown invariant (roadmap "güven" Faz 1).
--
-- A credit card's debt lives in `debt_amount` (total) plus a breakdown of
-- `statement_debt_amount` + `current_period_spending` + `provision_amount`.
-- These are three independently-mutable numeric fields and nothing guaranteed
-- that the breakdown could not exceed the total. Most card RPCs move debt and
-- breakdown together (so split <= debt holds), but `pay_card_debt` lowers
-- `debt_amount` while only reducing `statement_debt_amount`, leaving
-- current_period/provision untouched — so an over-payment can leave
-- split > debt. That is the recurring DataHealth "borç kırılımı tutarsız"
-- (error) and the manual "Düzelt" button.
--
-- A hard CHECK would reject pay_card_debt's write and break the app. Instead a
-- BEFORE trigger clamps the breakdown so split <= debt on every write — writes
-- never fail, the state is just normalised. The clamp priority matches the
-- existing DataHealth "Düzelt" logic exactly (statement most protected, then
-- provision, then current_period absorbs the remainder), so behaviour is
-- identical to the fix the user already approved — just automatic, and now
-- structurally impossible to violate.
--
-- Only `debt_amount` is left untouched, so the A2.1 ledger AFTER trigger (which
-- records the debt_amount delta) is unaffected. Already-consistent rows are a
-- no-op. numeric(14,2) is exact in the DB, so no float dust.

create or replace function public.clamp_card_breakdown()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.card_type = 'kredi_karti' then
    new.debt_amount := greatest(0, coalesce(new.debt_amount, 0));
    new.statement_debt_amount :=
      least(greatest(0, coalesce(new.statement_debt_amount, 0)), new.debt_amount);
    new.provision_amount :=
      least(greatest(0, coalesce(new.provision_amount, 0)),
            new.debt_amount - new.statement_debt_amount);
    new.current_period_spending :=
      least(greatest(0, coalesce(new.current_period_spending, 0)),
            new.debt_amount - new.statement_debt_amount - new.provision_amount);
  end if;
  return new;
end;
$$;

drop trigger if exists cards_clamp_breakdown on public.cards;
create trigger cards_clamp_breakdown
  before insert or update on public.cards
  for each row execute function public.clamp_card_breakdown();

-- One-time normalisation of existing credit cards whose breakdown already
-- exceeds the total debt. Same priority as the trigger. Does not touch
-- debt_amount, so the ledger trigger records no spurious event.
update public.cards
set statement_debt_amount = least(greatest(0, coalesce(statement_debt_amount, 0)), greatest(0, coalesce(debt_amount, 0))),
    provision_amount = least(
      greatest(0, coalesce(provision_amount, 0)),
      greatest(0, coalesce(debt_amount, 0)) - least(greatest(0, coalesce(statement_debt_amount, 0)), greatest(0, coalesce(debt_amount, 0)))
    ),
    current_period_spending = greatest(0, coalesce(debt_amount, 0))
      - least(greatest(0, coalesce(statement_debt_amount, 0)), greatest(0, coalesce(debt_amount, 0)))
      - least(
          greatest(0, coalesce(provision_amount, 0)),
          greatest(0, coalesce(debt_amount, 0)) - least(greatest(0, coalesce(statement_debt_amount, 0)), greatest(0, coalesce(debt_amount, 0)))
        ),
    updated_at = now()
where card_type = 'kredi_karti'
  and coalesce(statement_debt_amount, 0) + coalesce(current_period_spending, 0) + coalesce(provision_amount, 0)
      > coalesce(debt_amount, 0);
