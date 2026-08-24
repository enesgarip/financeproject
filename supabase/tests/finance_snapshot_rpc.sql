-- Açılış snapshot RPC'si (fetch_finance_snapshot): tek JSON yük, legacy
-- 17-sorgu yolunun birebir ikizi olmak zorunda.
--
-- Riskler:
--  1) Pencere filtresi kayarsa 25 aydan eski işlem/bütçe/harcama payload'a
--     sızar ya da sınırdaki satır düşer (legacy: >= karşılaştırması).
--  2) security invoker bozulursa başka kullanıcının satırı sızar (RLS).
--  3) optionalRows ikizi bozulursa migration bekleyen ortam TAMAMEN kırılır:
--     eksik opsiyonel tablo hata değil missing_tables kaydı olmalı, kalan
--     tablolar dolu dönmeli.
--  4) Sıralama/limit legacy sorgudan saparsa ekran sıraları değişir.
--  5) Oturumsuz çağrı veri değil hata döndürmeli.
begin;

-- İki TAZE test kullanıcısı (FK auth.users'a bağlı; login gerekmez). Seed
-- kullanıcısı bilerek KULLANILMAZ: yerel docker'da t@t.com'un geliştirme
-- verisi olabilir, sayım iddiaları ancak sıfırdan yaratılmış kullanıcıda
-- deterministiktir.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'snapshot-probe@t.com',
   'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'rls-probe@t.com',
   'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', '');

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- 1. kullanıcının verisi: 17 tablonun tamamı + pencere sınır satırları.
do $$
declare
  v_user uuid := '33333333-3333-3333-3333-333333333333';
  v_bank uuid := 'b0000000-0000-4000-8000-0000000000b1';
  v_card uuid := 'b0000000-0000-4000-8000-0000000000c1';
  v_loan uuid := 'b0000000-0000-4000-8000-0000000000f1';
  v_goal uuid := 'b0000000-0000-4000-8000-0000000000e1';
  v_comp uuid := 'b0000000-0000-4000-8000-0000000000e2';
  v_asset uuid := 'b0000000-0000-4000-8000-0000000000a1';
  v_archive_old uuid := 'b0000000-0000-4000-8000-0000000000d1';
  v_archive_new uuid := 'b0000000-0000-4000-8000-0000000000d2';
  v_window_start timestamptz := date_trunc('month', now()) - interval '24 months';
begin
  insert into public.assets (id, user_id, name, category, amount, unit, estimated_value_try, note)
  values (v_asset, v_user, 'Altın Şükrü İĞÜ', 'Altın', 12.50, 'gram', 1234.56, null);

  insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance)
  values (v_bank, v_user, 'Test Bank', 'Vadesiz', 'banka_karti', 20000.10);

  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, statement_debt_amount)
  values (v_card, v_user, 'Test Bank', 'Kredili', 'kredi_karti', 50000, 5000, 5000);

  insert into public.loans (id, user_id, bank_name, loan_name, total_amount, remaining_amount, monthly_payment, remaining_installments)
  values (v_loan, v_user, 'Test Bank', 'İhtiyaç kredisi', 24000, 4000, 2000, 2);

  insert into public.loan_installments (user_id, loan_id, installment_no, due_date, amount)
  values (v_user, v_loan, 1, current_date + 10, 2000.25),
         (v_user, v_loan, 2, current_date + 40, 2000.25);

  insert into public.debts (user_id, person_name, direction, value_type, amount, estimated_value_try)
  values (v_user, 'Ömer ağabey', 'borç_aldım', 'TRY', 750.40, 750.40);

  insert into public.payments (user_id, title, amount, due_date)
  values (v_user, 'Kira ödemesi', 15000, current_date + 5);

  -- Sıralama kontrolü: bilerek önce ESKİ maaş eklenir; payload yeniyi başa koymalı.
  insert into public.salary_history (user_id, title, amount, effective_date)
  values (v_user, 'Maaş', 40000, current_date - 200),
         (v_user, 'Maaş', 55000.50, current_date - 10);

  -- Pencere: sınırın TAM üstü dahil (>=), 1 gün öncesi hariç.
  insert into public.transaction_history (user_id, occurred_at, type, title, amount)
  values (v_user, now(), 'payment', 'Kirâ ödemesi İĞÜ', 1500.50),
         (v_user, v_window_start, 'payment', 'Pencere sınırındaki işlem', 10),
         (v_user, v_window_start - interval '1 day', 'payment', 'Pencere dışı işlem', 99);

  insert into public.budgets (user_id, month, category, limit_amount)
  values (v_user, date_trunc('month', now())::date, 'Market', 3000),
         (v_user, (v_window_start - interval '2 months')::date, 'Market', 2000);

  insert into public.card_expenses (user_id, card_id, spent_at, amount, description)
  values (v_user, v_card, current_date, 250.75, 'Şarküteri ölçüm İĞÜ'),
         (v_user, v_card, v_window_start::date - 1, 90.10, 'Pencere dışı harcama');

  -- Sıralama kontrolü: önce GEÇ ay eklenir; payload due_month artan istemeli.
  insert into public.card_installments (user_id, card_id, installment_no, installment_count, due_month, amount, description)
  values (v_user, v_card, 2, 2, (date_trunc('month', now()) + interval '2 months')::date, 500, 'Telefon taksiti'),
         (v_user, v_card, 1, 2, (date_trunc('month', now()) + interval '1 month')::date, 500, 'Telefon taksiti');

  insert into public.card_statement_archives (
    id, user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status
  )
  values
    (v_archive_old, v_user, v_card, 2026, 6, date '2026-06-25', 4000, 4000, 4000, 'paid'),
    (v_archive_new, v_user, v_card, 2026, 7, date '2026-07-25', 5000, 5000, 5000, 'open');

  insert into public.card_statement_payments (user_id, card_id, statement_archive_id, source_card_id, amount)
  values (v_user, v_card, v_archive_new, v_bank, 1000);

  insert into public.savings_goals (id, user_id, name, target_amount, current_amount)
  values (v_goal, v_user, 'Acil fon', 100000, 25000.75);

  insert into public.savings_goal_components (id, user_id, goal_id, label, value_type, target_amount, current_amount, sort_order)
  values (v_comp, v_user, v_goal, 'Nakit ayağı', 'TRY', 60000, 10000, 0);

  insert into public.savings_goal_sources (user_id, goal_id, component_id, kind, asset_id, sort_order)
  values (v_user, v_goal, null, 'asset', v_asset, 0);

  insert into public.account_reconciliations (user_id, card_id, target, app_amount, real_amount, drift)
  values (v_user, v_bank, 'balance', 20000.10, 20000.00, 0.10);
end $$;

-- 2. kullanıcının verisi (RLS sondası): kendi claims'iyle yazılır.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  insert into public.assets (id, user_id, name, category, amount, unit, estimated_value_try)
  values ('c0000000-0000-4000-8000-0000000000a2', '22222222-2222-2222-2222-222222222222', 'Yabancı varlık', 'Nakit', 1, 'TRY', 1);

  insert into public.cards (user_id, bank_name, card_name, card_type, current_balance)
  values ('22222222-2222-2222-2222-222222222222', 'Öteki Bank', 'Yabancı hesap', 'banka_karti', 5);
end $$;

-- 1. kullanıcı gözünden payload doğrulaması.
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_window_start timestamptz := date_trunc('month', now()) - interval '24 months';
  v_payload jsonb;
  v_limited jsonb;
  v_expected_counts constant jsonb := jsonb_build_object(
    'assets', 1, 'cards', 2, 'loans', 1, 'loan_installments', 2, 'debts', 1,
    'payments', 1, 'salary_history', 2, 'transaction_history', 2, 'budgets', 1,
    'card_expenses', 1, 'card_installments', 2, 'card_statement_archives', 2,
    'card_statement_payments', 1, 'savings_goals', 1, 'savings_goal_components', 1,
    'savings_goal_sources', 1, 'account_reconciliations', 1
  );
  v_key text;
begin
  v_payload := public.fetch_finance_snapshot(v_window_start, v_window_start::date, 120);

  -- 1) Her tablo anahtarı var ve satır sayısı beklenen (pencere + RLS süzülmüş).
  for v_key in select jsonb_object_keys(v_expected_counts)
  loop
    if v_payload->v_key is null then
      raise exception 'BAŞARISIZ: payload''da % anahtarı yok.', v_key;
    end if;
    if jsonb_array_length(v_payload->v_key) <> (v_expected_counts->>v_key)::int then
      raise exception 'BAŞARISIZ: % için % satır bekleniyordu, % geldi.',
        v_key, v_expected_counts->>v_key, jsonb_array_length(v_payload->v_key);
    end if;
  end loop;

  if v_payload->'missing_tables' <> '[]'::jsonb then
    raise exception 'BAŞARISIZ: tam şemada missing_tables boş olmalıydı: %', v_payload->'missing_tables';
  end if;

  -- 2) RLS: 2. kullanıcının satırı sızmamalı.
  if v_payload->'assets' @> '[{"id":"c0000000-0000-4000-8000-0000000000a2"}]'::jsonb then
    raise exception 'BAŞARISIZ: başka kullanıcının varlığı payload''a sızdı.';
  end if;

  -- 3) Pencere: sınır satırı dahil (>=), öncesi hariç.
  if not v_payload->'transaction_history' @> '[{"title":"Pencere sınırındaki işlem"}]'::jsonb then
    raise exception 'BAŞARISIZ: pencere sınırındaki işlem (>=) payload''da yok.';
  end if;
  if v_payload->'transaction_history' @> '[{"title":"Pencere dışı işlem"}]'::jsonb then
    raise exception 'BAŞARISIZ: pencere dışı işlem payload''a sızdı.';
  end if;

  -- 4) Sıralamalar legacy sorgularla aynı.
  if (v_payload->'salary_history'->0->>'effective_date')::date <= (v_payload->'salary_history'->1->>'effective_date')::date then
    raise exception 'BAŞARISIZ: salary_history effective_date DESC değil.';
  end if;
  if (v_payload->'transaction_history'->0->>'occurred_at')::timestamptz <= (v_payload->'transaction_history'->1->>'occurred_at')::timestamptz then
    raise exception 'BAŞARISIZ: transaction_history occurred_at DESC değil.';
  end if;
  if (v_payload->'card_installments'->0->>'due_month')::date >= (v_payload->'card_installments'->1->>'due_month')::date then
    raise exception 'BAŞARISIZ: card_installments due_month ASC değil.';
  end if;
  if (v_payload->'card_statement_archives'->0->>'statement_date')::date <= (v_payload->'card_statement_archives'->1->>'statement_date')::date then
    raise exception 'BAŞARISIZ: card_statement_archives statement_date DESC değil.';
  end if;

  -- 5) Değer aslına sadık: numeric JSON sayısı olarak, tablodaki satırla birebir.
  if (v_payload->'assets'->0->>'estimated_value_try')::numeric <> 1234.56 then
    raise exception 'BAŞARISIZ: numeric alan bozuldu (%).', v_payload->'assets'->0->>'estimated_value_try';
  end if;
  if v_payload->'assets'->0 <> (select to_jsonb(a) from public.assets a where a.id = 'b0000000-0000-4000-8000-0000000000a1') then
    raise exception 'BAŞARISIZ: asset satırı tablo satırıyla birebir değil.';
  end if;

  -- 6) Limit parametresi: 1 istenirse yalnız en yeni arşiv döner.
  v_limited := public.fetch_finance_snapshot(v_window_start, v_window_start::date, 1);
  if jsonb_array_length(v_limited->'card_statement_archives') <> 1
    or v_limited->'card_statement_archives'->0->>'id' <> 'b0000000-0000-4000-8000-0000000000d2' then
    raise exception 'BAŞARISIZ: statement limit 1 en yeni arşivi döndürmedi.';
  end if;

  raise notice 'GEÇTİ: payload anahtarları, satır sayıları, RLS, pencere, sıralama, limit.';
end $$;

-- 2. kullanıcı gözünden: yalnız kendi satırları.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_payload jsonb;
begin
  v_payload := public.fetch_finance_snapshot(now() - interval '24 months', (now() - interval '24 months')::date, 120);
  if jsonb_array_length(v_payload->'assets') <> 1
    or v_payload->'assets'->0->>'id' <> 'c0000000-0000-4000-8000-0000000000a2'
    or jsonb_array_length(v_payload->'cards') <> 1
    or jsonb_array_length(v_payload->'loans') <> 0 then
    raise exception 'BAŞARISIZ: 2. kullanıcı yalnız kendi satırlarını görmeli.';
  end if;
  raise notice 'GEÇTİ: ikinci kullanıcı yalnız kendi verisini görüyor.';
end $$;

-- optionalRows ikizi: opsiyonel tablo yokken hata DEĞİL missing_tables kaydı.
reset role;
drop table public.account_reconciliations;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_window_start timestamptz := date_trunc('month', now()) - interval '24 months';
  v_payload jsonb;
  v_guarded boolean := false;
begin
  v_payload := public.fetch_finance_snapshot(v_window_start, v_window_start::date, 120);

  if v_payload->'missing_tables' <> '["account_reconciliations"]'::jsonb then
    raise exception 'BAŞARISIZ: eksik tablo missing_tables''a yazılmadı: %', v_payload->'missing_tables';
  end if;
  if v_payload->'account_reconciliations' <> '[]'::jsonb then
    raise exception 'BAŞARISIZ: eksik tablo boş liste dönmeliydi.';
  end if;
  if jsonb_array_length(v_payload->'savings_goals') <> 1 or jsonb_array_length(v_payload->'cards') <> 2 then
    raise exception 'BAŞARISIZ: eksik tablo kalan payload''ı bozdu.';
  end if;

  -- Oturumsuz çağrı reddedilir.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform public.fetch_finance_snapshot(v_window_start, v_window_start::date, 120);
  exception when others then
    v_guarded := sqlerrm like '%Oturum bulunamadı%';
  end;
  if not v_guarded then
    raise exception 'BAŞARISIZ: oturumsuz çağrı reddedilmedi.';
  end if;

  raise notice 'GEÇTİ: eksik opsiyonel tablo graceful, oturumsuz çağrı reddedildi.';
end $$;

rollback;
