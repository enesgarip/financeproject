-- Extend the transaction_history type check to include 'correction'.
-- The cancel_card_expense RPC (20260620160000) writes type='correction'
-- but the original constraint only allowed payment/transfer/loan/debt/card.

alter table public.transaction_history
drop constraint if exists transaction_history_type_check;

alter table public.transaction_history
add constraint transaction_history_type_check
check (type in ('payment', 'transfer', 'loan', 'debt', 'card', 'correction'));
