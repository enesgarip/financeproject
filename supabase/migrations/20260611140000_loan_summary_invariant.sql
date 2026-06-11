-- Loan summary = installment projection (roadmap "güven" Faz 2).
--
-- A loan's summary lives in `remaining_amount` + `remaining_installments` +
-- `status`, but the correct value is DERIVED from its installment plan:
-- remaining = sum of unpaid (`status <> 'ödendi'`) installment amounts,
-- remaining_installments = count of unpaid, status = 'closed' when none unpaid
-- else 'active'. The pay/unpay RPCs already recompute this correctly, but the
-- client writes installments directly (LoansPage schedule upsert / edit / delete)
-- and recomputes the summary in a separate step that can be skipped or fail —
-- leaving the summary stale (DataHealth `loanTotals`, severity error).
--
-- This trigger makes the summary a projection maintained on every installment
-- write, no matter who writes it, so `loanTotals` drift becomes structurally
-- impossible. Loans with no installments (no plan yet) are never touched — the
-- trigger only fires on installment rows, so the manual opening summary stands.
-- `total_amount` / `monthly_payment` are NOT derived and left alone.

create or replace function public.sync_loan_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan_id uuid := coalesce(new.loan_id, old.loan_id);
  v_remaining_amount numeric(14, 2);
  v_remaining_installments integer;
begin
  select coalesce(sum(amount), 0), count(*)
  into v_remaining_amount, v_remaining_installments
  from public.loan_installments
  where loan_id = v_loan_id and status <> 'ödendi';

  update public.loans
  set remaining_amount = v_remaining_amount,
      remaining_installments = v_remaining_installments,
      status = case when v_remaining_installments = 0 then 'closed' else 'active' end,
      updated_at = now()
  where id = v_loan_id;

  return null; -- AFTER trigger: return value ignored
end;
$$;

drop trigger if exists loan_installments_sync_summary on public.loan_installments;
create trigger loan_installments_sync_summary
  after insert or update or delete on public.loan_installments
  for each row execute function public.sync_loan_summary();

-- One-time normalisation: pull every loan that has a plan to its projection.
-- Writes `loans` (not `loan_installments`), so it does NOT fire the trigger
-- above — no loop. Idempotent.
update public.loans l
set remaining_amount = sub.remaining_amount,
    remaining_installments = sub.remaining_installments,
    status = case when sub.remaining_installments = 0 then 'closed' else 'active' end,
    updated_at = now()
from (
  select loan_id,
         coalesce(sum(amount) filter (where status <> 'ödendi'), 0) as remaining_amount,
         count(*) filter (where status <> 'ödendi') as remaining_installments
  from public.loan_installments
  group by loan_id
) sub
where l.id = sub.loan_id
  and (l.remaining_amount is distinct from sub.remaining_amount
       or l.remaining_installments is distinct from sub.remaining_installments
       or l.status is distinct from case when sub.remaining_installments = 0 then 'closed' else 'active' end);
