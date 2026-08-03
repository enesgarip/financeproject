-- Regression: Data Health "Bu doğru, kapat" acknowledgements are auth-bound,
-- cross-device server state; clients cannot forge rows directly.
-- Run with: npm run db:test:data-health-acknowledgements
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'data-health-ack-cross@example.test', '',
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}',
  '', '', '', ''
)
on conflict (id) do nothing;

insert into public.data_health_issue_acknowledgements (
  user_id, issue_id
)
values (
  '22222222-2222-2222-2222-222222222222',
  'other-user-issue'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_denied boolean := false;
  v_count integer;
begin
  if has_table_privilege('authenticated', 'public.data_health_issue_acknowledgements', 'INSERT')
     or has_table_privilege('authenticated', 'public.data_health_issue_acknowledgements', 'UPDATE')
     or has_table_privilege('authenticated', 'public.data_health_issue_acknowledgements', 'DELETE') then
    raise exception 'SECURITY FAIL: authenticated can mutate acknowledgements directly';
  end if;

  if not has_table_privilege('authenticated', 'public.data_health_issue_acknowledgements', 'SELECT') then
    raise exception 'SECURITY FAIL: authenticated cannot read own acknowledgements';
  end if;

  if has_function_privilege('public', 'public.acknowledge_data_health_issues(text[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.acknowledge_data_health_issues(text[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.acknowledge_data_health_issues(text[])', 'EXECUTE') then
    raise exception 'SECURITY FAIL: acknowledge RPC grants are incorrect';
  end if;

  if has_function_privilege('public', 'public.clear_data_health_issue_acknowledgements()', 'EXECUTE')
     or has_function_privilege('anon', 'public.clear_data_health_issue_acknowledgements()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.clear_data_health_issue_acknowledgements()', 'EXECUTE') then
    raise exception 'SECURITY FAIL: clear RPC grants are incorrect';
  end if;

  begin
    insert into public.data_health_issue_acknowledgements (user_id, issue_id)
    values ('11111111-1111-1111-1111-111111111111', 'forged-direct-row');
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'SECURITY FAIL: direct acknowledgement insert was not denied';
  end if;

  perform public.acknowledge_data_health_issues(
    array[' issue-2 ', 'issue-1', 'issue-1']
  );

  select count(*) into v_count
  from public.data_health_issue_acknowledgements;
  if v_count <> 2 then
    raise exception 'ACK FAIL: expected 2 own visible rows, got %', v_count;
  end if;

  if exists (
    select 1
    from public.data_health_issue_acknowledgements
    where issue_id = 'other-user-issue'
  ) then
    raise exception 'RLS FAIL: cross-user acknowledgement is visible';
  end if;

  v_denied := false;
  begin
    perform public.acknowledge_data_health_issues(array['']);
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'VALIDATION FAIL: blank issue ID was accepted';
  end if;

  perform public.clear_data_health_issue_acknowledgements();

  select count(*) into v_count
  from public.data_health_issue_acknowledgements;
  if v_count <> 0 then
    raise exception 'CLEAR FAIL: own acknowledgements survived';
  end if;

  raise notice 'Data Health acknowledgement regression OK: RPC, RLS and grants verified.';
end $$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.data_health_issue_acknowledgements
    where user_id = '22222222-2222-2222-2222-222222222222'
      and issue_id = 'other-user-issue'
  ) then
    raise exception 'ISOLATION FAIL: clearing one user removed another user row';
  end if;
end $$;

rollback;
