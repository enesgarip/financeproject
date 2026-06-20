-- Deterministic card-expense fingerprint for duplicate detection and import reconciliation.

alter table public.card_expenses
  add column if not exists transaction_fingerprint text;

create or replace function private.normalize_transaction_description(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(lower(replace(replace(coalesce(p_value, ''), 'I', 'i'), 'İ', 'i')), '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function private.card_expense_transaction_fingerprint(
  p_card_id uuid,
  p_spent_at date,
  p_amount numeric,
  p_description text,
  p_status text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(p_card_id::text, '') || '|' ||
    coalesce(p_spent_at::text, '') || '|' ||
    coalesce(round(p_amount * 100)::bigint::text, '') || '|' ||
    private.normalize_transaction_description(p_description) || '|' ||
    lower(replace(replace(coalesce(p_status, ''), 'I', 'i'), 'İ', 'i'));
$$;

create or replace function public.set_card_expense_transaction_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.transaction_fingerprint := private.card_expense_transaction_fingerprint(
    new.card_id,
    new.spent_at,
    new.amount,
    new.description,
    new.status
  );
  return new;
end;
$$;

drop trigger if exists set_card_expense_transaction_fingerprint on public.card_expenses;
create trigger set_card_expense_transaction_fingerprint
  before insert or update of card_id, spent_at, amount, description, status
  on public.card_expenses
  for each row
  execute function public.set_card_expense_transaction_fingerprint();

update public.card_expenses
set transaction_fingerprint = private.card_expense_transaction_fingerprint(
  card_id,
  spent_at,
  amount,
  description,
  status
)
where transaction_fingerprint is null
   or transaction_fingerprint <> private.card_expense_transaction_fingerprint(
    card_id,
    spent_at,
    amount,
    description,
    status
  );

create index if not exists card_expenses_user_fingerprint_idx
  on public.card_expenses (user_id, transaction_fingerprint)
  where status <> 'cancelled';
