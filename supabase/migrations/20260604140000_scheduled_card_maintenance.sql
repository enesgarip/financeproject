-- Phase 2: server-side scheduled card maintenance.
--
-- Time-based card transitions (statement cutting, stale-provision posting) used
-- to run only when the user opened the app, which also meant a late visit cut a
-- statement with the wrong (late) date. This migration runs them daily on the
-- server so they happen on the correct day even if the app stays closed.
--
-- Design: instead of duplicating the audited per-user money logic, the batch
-- function impersonates each user by setting the JWT "sub" claim and calls the
-- EXISTING, tested RPCs (cut_due_card_statements, post_card_provision), which
-- key off auth.uid(). Zero changes to the core statement/provision logic.

create or replace function public.run_scheduled_card_maintenance(
  p_provision_stale_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
  v_expense record;
  v_user_count integer := 0;
  v_statements_cut integer := 0;
  v_provisions_posted integer := 0;
  v_cut integer;
begin
  for v_user in
    select distinct user_id
    from public.cards
    where card_type = 'kredi_karti'
  loop
    v_user_count := v_user_count + 1;

    -- Run the rest of this iteration as this user so the per-user RPCs that read
    -- auth.uid() operate on exactly their rows (transaction-local, reset below).
    perform set_config('request.jwt.claim.sub', v_user.user_id::text, true);

    begin
      v_cut := public.cut_due_card_statements();
      v_statements_cut := v_statements_cut + coalesce(v_cut, 0);
    exception
      when others then
        raise notice 'Ekstre kesimi basarisiz (kullanici %): %', v_user.user_id, sqlerrm;
    end;

    -- Provisions still pending past the threshold are treated as cleared and
    -- posted into the current period. post_card_provision writes transaction
    -- history, so the user can see (and, if wrong, the row remains auditable).
    for v_expense in
      select id
      from public.card_expenses
      where user_id = v_user.user_id
        and status = 'provision'
        and spent_at <= (current_date - p_provision_stale_days)
    loop
      begin
        perform public.post_card_provision(v_expense.id);
        v_provisions_posted := v_provisions_posted + 1;
      exception
        when others then
          raise notice 'Provizyon dusurme basarisiz (harcama %): %', v_expense.id, sqlerrm;
      end;
    end loop;
  end loop;

  -- Clear the impersonation so nothing downstream inherits it.
  perform set_config('request.jwt.claim.sub', '', true);

  return jsonb_build_object(
    'users', v_user_count,
    'statements_cut', v_statements_cut,
    'provisions_posted', v_provisions_posted,
    'provision_stale_days', p_provision_stale_days,
    'ran_at', now()
  );
end;
$$;

-- Only the scheduler (job owner) may run this. New functions default to PUBLIC
-- EXECUTE, which would let any authenticated user trigger maintenance for EVERY
-- user — revoke it explicitly.
revoke execute on function public.run_scheduled_card_maintenance(integer) from public;

-- Schedule it daily. Resilient: if pg_cron is unavailable (e.g. not enabled on
-- the target instance) the function is still created and can be invoked manually
-- or kept as the existing client-side fallback; the deploy is never blocked.
do $$
begin
  create extension if not exists pg_cron;

  -- pg_cron upserts by job name; unschedule first to stay idempotent across redeploys.
  begin
    perform cron.unschedule('card-maintenance-daily');
  exception
    when others then
      null;
  end;

  perform cron.schedule(
    'card-maintenance-daily',
    '5 0 * * *',
    $cron$ select public.run_scheduled_card_maintenance(); $cron$
  );
exception
  when others then
    raise notice 'pg_cron zamanlamasi atlandi (eklenti yok olabilir): %', sqlerrm;
end;
$$;
