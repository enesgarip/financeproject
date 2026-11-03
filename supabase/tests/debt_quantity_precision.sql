-- F011: real partial RPC + same-rate revaluation, including repeated payments.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_account uuid;
  v_debt public.debts%rowtype;
  v_case record;
  v_direction text;
  v_paid numeric;
  v_balance numeric;
  v_before numeric;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, current_balance)
  values (v_user, 'LOCAL F011', 'Precision', 'banka_karti', 100000) returning id into v_account;
  for v_case in select * from (values ('gram_altin', null::text, 5000::numeric), ('ceyrek_altin', null::text, 8000::numeric), ('doviz', 'USD', 40::numeric), ('TRY', 'TRY', 1::numeric)) as t(unit, currency, rate)
  loop
    foreach v_direction in array array['borç_aldım', 'borç_verdim'] loop
      select current_balance into v_before from public.cards where id = v_account;
      insert into public.debts (user_id, person_name, direction, value_type, currency, amount, estimated_value_try, auto_valued)
      values (v_user, 'LOCAL F011', v_direction, v_case.unit, v_case.currency, case when v_case.unit = 'TRY' then 100 else 1 end, case when v_case.unit = 'TRY' then 100 else v_case.rate end, true) returning * into v_debt;
      v_paid := round(v_debt.estimated_value_try / 3, 2);
      v_debt := public.settle_personal_debt(v_debt.id, v_account, v_paid);
      if round(v_debt.amount * v_case.rate, 2) <> v_debt.estimated_value_try then
        raise exception 'FAIL first partial %: qty=% value=%', v_case.unit, v_debt.amount, v_debt.estimated_value_try;
      end if;
      v_debt := public.settle_personal_debt(v_debt.id, v_account, v_paid);
      if round(v_debt.amount * v_case.rate, 2) <> v_debt.estimated_value_try then
        raise exception 'FAIL repeated partial %: qty=% value=%', v_case.unit, v_debt.amount, v_debt.estimated_value_try;
      end if;
      v_paid := v_paid * 2 + v_debt.estimated_value_try;
      v_debt := public.settle_personal_debt(v_debt.id, v_account, null);
      if v_debt.status <> 'kapandı' then raise exception 'FAIL full close'; end if;
      select current_balance into v_balance from public.cards where id = v_account;
      if v_balance <> v_before + (case when v_direction = 'borç_verdim' then v_paid else -v_paid end) then raise exception 'FAIL balance conservation'; end if;
      if (select count(*) from public.transaction_history where source_id = v_debt.id) <> 3 then raise exception 'FAIL immutable payment history'; end if;
    end loop;
  end loop;
  raise notice 'F011 quantity precision: 8 cases, repeated partial + full close + balance/history OK';
end $$;
rollback;
