drop policy if exists "dismissed_upcoming_items_update_own" on public.dismissed_upcoming_items;
create policy "dismissed_upcoming_items_update_own" on public.dismissed_upcoming_items
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
