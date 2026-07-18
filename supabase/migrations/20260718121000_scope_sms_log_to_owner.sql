-- Unmatched SMS rows can contain raw financial text but have no owner. They are
-- service-role diagnostics and must never be visible to every authenticated user.
drop policy if exists "sms_log_select_own" on public.sms_log;
create policy "sms_log_select_own"
  on public.sms_log for select
  to authenticated
  using (user_id = (select auth.uid()));
