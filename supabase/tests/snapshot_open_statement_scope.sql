-- F009: a global paid-history cap must never displace an older open liability.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_open uuid;
  v_payload jsonb;
  v_count integer;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, debt_amount, statement_debt_amount)
  values (v_user, 'LOCAL F009', 'Scope', 'kredi_karti', 3000, 3000) returning id into v_card;
  insert into public.card_statement_archives (user_id, card_id, period_year, period_month, statement_date, due_date, statement_debt_amount, status)
  select v_user, v_card, extract(year from d)::integer, extract(month from d)::integer, d::date, (d + interval '10 days')::date, 100, 'paid'
  from generate_series(date '2010-01-01', date '2020-06-01', interval '1 month') as d;
  insert into public.card_statement_archives (user_id, card_id, period_year, period_month, statement_date, due_date, statement_debt_amount, status)
  values (v_user, v_card, 2000, 1, '2000-01-25', '2000-02-05', 3000, 'open') returning id into v_open;
  v_payload := public.fetch_finance_snapshot(now() - interval '25 months', current_date - 800, 120);
  if not exists (select 1 from jsonb_array_elements(v_payload->'card_statement_archives') t where t->>'id' = v_open::text and t->>'due_date' = '2000-02-05') then
    raise exception 'FAIL: old open statement/due date lost behind 126 paid archives';
  end if;
  select count(*) into v_count from jsonb_array_elements(v_payload->'card_statement_archives') t where t->>'status' = 'paid';
  if v_count <> 120 then raise exception 'FAIL: paid history limit %', v_count; end if;
  v_payload := public.fetch_finance_snapshot(now(), current_date, 0);
  if not exists (select 1 from jsonb_array_elements(v_payload->'card_statement_archives') t where t->>'id' = v_open::text) then raise exception 'FAIL: zero paid cap hides liability'; end if;
  raise notice 'F009: 126 paid archives + old open archive, original due date and paid cap OK';
end $$;
rollback;
