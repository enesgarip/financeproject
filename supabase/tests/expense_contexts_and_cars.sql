-- Regression: reporting contexts remain own-row annotations and never provide a
-- cross-user card-tag path. Run with: npm run db:test:expense-contexts-cars
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'other-context@test.local', '',
  now(), now(), '{}', '{}'
) on conflict (id) do nothing;

insert into public.expense_contexts (id, user_id, kind, name)
values (
  'b0000000-0000-4000-8000-000000000001',
  '22222222-2222-2222-2222-222222222222',
  'pet', 'Başkasının bağlamı'
);

insert into public.cars (id, user_id, name)
values (
  'b0000000-0000-4000-8000-000000000002',
  '22222222-2222-2222-2222-222222222222',
  'Başkasının aracı'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_context uuid := 'b0000000-0000-4000-8000-000000000003';
  v_car uuid := 'b0000000-0000-4000-8000-000000000004';
  v_card uuid := 'b0000000-0000-4000-8000-000000000005';
  v_expense uuid := 'b0000000-0000-4000-8000-000000000006';
  v_denied boolean := false;
begin
  insert into public.expense_contexts (id, user_id, kind, name, budget_amount)
  values (v_context, v_user, 'project', 'Taşınma', 10000);

  insert into public.context_expenses (user_id, context_id, amount, category, description)
  values (v_user, v_context, 500, 'Hizmet', 'Nakliye');

  insert into public.cars (id, user_id, name, current_odometer_km)
  values (v_car, v_user, 'Test aracı', 10000);

  insert into public.car_expenses (
    user_id, car_id, amount, category, fuel_liters, odometer_km, description
  ) values (v_user, v_car, 1200, 'Yakıt', 40, 10600, 'Dolum');

  insert into public.car_reminders (
    user_id, car_id, title, due_date, repeat_months
  ) values (v_user, v_car, 'Muayene', current_date + 7, 24);

  begin
    insert into public.car_expenses (user_id, car_id, amount, description)
    values (v_user, 'b0000000-0000-4000-8000-000000000002', 10, 'Forged car expense');
  exception when others then
    v_denied := sqlstate = '42501';
  end;
  if not v_denied then raise exception 'SECURITY FAIL: cross-user manual car expense accepted'; end if;
  v_denied := false;

  insert into public.cards (id, user_id, bank_name, card_name, card_type)
  values (v_card, v_user, 'Test', 'Bağlam kartı', 'kredi_karti');

  insert into public.card_expenses (
    id, user_id, card_id, amount, installment_amount, description,
    status, car_id, context_id, fuel_liters, odometer_km
  ) values (
    v_expense, v_user, v_card, 1000, 1000, 'Etiketli dolum',
    'posted', v_car, v_context, 35, 11000
  );

  begin
    update public.card_expenses
    set context_id = 'b0000000-0000-4000-8000-000000000001'
    where id = v_expense;
  exception when others then
    v_denied := sqlstate = 'P0001';
  end;
  if not v_denied then raise exception 'SECURITY FAIL: cross-user context tag accepted'; end if;

  v_denied := false;
  begin
    update public.card_expenses
    set car_id = 'b0000000-0000-4000-8000-000000000002'
    where id = v_expense;
  exception when others then
    v_denied := sqlstate = 'P0001';
  end;
  if not v_denied then raise exception 'SECURITY FAIL: cross-user car tag accepted'; end if;

  if (select count(*) from public.expense_contexts) <> 1 then
    raise exception 'RLS FAIL: another user context is visible';
  end if;
  if (select count(*) from public.cars) <> 1 then
    raise exception 'RLS FAIL: another user car is visible';
  end if;

  raise notice 'Expense contexts/cars regression OK: own rows work, forged tags denied.';
end $$;

rollback;
