create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop policy if exists "assets_select_own" on public.assets;
create policy "assets_select_own" on public.assets
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "assets_insert_own" on public.assets;
create policy "assets_insert_own" on public.assets
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "assets_update_own" on public.assets;
create policy "assets_update_own" on public.assets
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "assets_delete_own" on public.assets;
create policy "assets_delete_own" on public.assets
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "cards_select_own" on public.cards;
create policy "cards_select_own" on public.cards
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "cards_insert_own" on public.cards;
create policy "cards_insert_own" on public.cards
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "cards_update_own" on public.cards;
create policy "cards_update_own" on public.cards
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "cards_delete_own" on public.cards;
create policy "cards_delete_own" on public.cards
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "loans_select_own" on public.loans;
create policy "loans_select_own" on public.loans
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "loans_insert_own" on public.loans;
create policy "loans_insert_own" on public.loans
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "loans_update_own" on public.loans;
create policy "loans_update_own" on public.loans
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "loans_delete_own" on public.loans;
create policy "loans_delete_own" on public.loans
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "debts_select_own" on public.debts;
create policy "debts_select_own" on public.debts
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "debts_insert_own" on public.debts;
create policy "debts_insert_own" on public.debts
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "debts_update_own" on public.debts;
create policy "debts_update_own" on public.debts
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "debts_delete_own" on public.debts;
create policy "debts_delete_own" on public.debts
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "payments_insert_own" on public.payments;
create policy "payments_insert_own" on public.payments
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "payments_update_own" on public.payments;
create policy "payments_update_own" on public.payments
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "payments_delete_own" on public.payments;
create policy "payments_delete_own" on public.payments
for delete to authenticated
using (user_id = (select auth.uid()));
