-- Transaksiyonel restore (R1): round-trip sadakati, tek-transaction rollback,
-- bilinmeyen kolon/tablo reddi, settlement sıyırma, çapraz-parent sızıntı reddi.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

create temp table _snapshot_counts (tbl text primary key, n bigint);

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_order text[] := array[
    'cards','cars','expense_contexts','card_aliases','assets','loans',
    'savings_goals','budgets','kasa_buckets','wishlist_items','debts',
    'salary_history','gold_lots','net_worth_snapshots','savings_goal_snapshots',
    'card_statement_archives','card_statement_payments','car_reminders',
    'car_expenses','context_expenses','card_expenses','card_installments',
    'loan_installments','savings_goal_components','savings_goal_sources',
    'payments','transaction_history','account_reconciliations',
    'dismissed_upcoming_items','push_subscriptions','notification_preferences'
  ];
  v_tbl text;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_payload jsonb;
  v_report jsonb;
  v_n bigint;
  v_expected bigint;
  v_drift numeric;
begin
  -- Seed verisinden "export" derle (ledger + settlement tabloları bilinçli yok).
  foreach v_tbl in array v_order loop
    execute pg_catalog.format(
      'select coalesce(jsonb_agg(pg_catalog.to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.user_id = $1',
      v_tbl
    ) into v_rows using v_user;
    if jsonb_array_length(v_rows) > 0 then
      v_tables := v_tables || jsonb_build_object(v_tbl, v_rows);
    end if;
    execute pg_catalog.format('select count(*) from public.%I t where t.user_id = $1', v_tbl)
      into v_n using v_user;
    insert into _snapshot_counts values (v_tbl, v_n);
  end loop;
  v_payload := jsonb_build_object('schema', 'financeproject-v2', 'tables', v_tables);

  -- 1) ROLLBACK KANITI: bilinmeyen kolonlu payload her şeyi geri alır —
  --    reset dahil. (Bozuk satır cards'a eklendi ki reset+insert yolu açılsın.)
  begin
    perform public.restore_user_finance_data_tx(
      jsonb_set(v_payload, '{tables,cards,0,uydurma_kolon}', '"x"')
    );
    raise exception 'BAŞARISIZ: bilinmeyen kolon kabul edildi.';
  exception
    when raise_exception then
      if sqlerrm like 'BAŞARISIZ%' then raise; end if;
  end;
  select count(*) into v_n from public.cards where user_id = v_user;
  select n into v_expected from _snapshot_counts where tbl = 'cards';
  if v_n <> v_expected then
    raise exception 'BAŞARISIZ: rollback yarım kaldı — cards % (beklenen %).', v_n, v_expected;
  end if;

  -- 2) Bilinmeyen tablo reddi.
  begin
    perform public.restore_user_finance_data_tx(
      jsonb_build_object('schema', 'financeproject-v2', 'tables', jsonb_build_object('sahte_tablo', '[]'::jsonb))
    );
    raise exception 'BAŞARISIZ: bilinmeyen tablo kabul edildi.';
  exception
    when raise_exception then
      if sqlerrm like 'BAŞARISIZ%' then raise; end if;
  end;

  -- 3) ROUND-TRIP: gerçek payload'la geri yükle; her tablo sayımı birebir.
  v_report := public.restore_user_finance_data_tx(v_payload);
  if coalesce((v_report->>'ok')::boolean, false) is not true then
    raise exception 'BAŞARISIZ: restore ok dönmedi (%).', v_report;
  end if;
  foreach v_tbl in array v_order loop
    execute pg_catalog.format('select count(*) from public.%I t where t.user_id = $1', v_tbl)
      into v_n using v_user;
    select n into v_expected from _snapshot_counts where tbl = v_tbl;
    if v_n <> v_expected then
      raise exception 'BAŞARISIZ: % round-trip sayımı % (beklenen %).', v_tbl, v_n, v_expected;
    end if;
  end loop;

  -- 4) Ledger'lar opening'le dürüstçe yeniden başladı: borç/bakiye = projeksiyon.
  select coalesce(sum(pg_catalog.abs(c.debt_amount - pg_catalog.round(coalesce(l.s, 0) / 100.0, 2))), 0)
  into v_drift
  from public.cards c
  left join (
    select card_id, sum(amount_kurus) s from public.card_ledger group by card_id
  ) l on l.card_id = c.id
  where c.user_id = v_user and c.card_type = 'kredi_karti';
  if v_drift <> 0 then
    raise exception 'BAŞARISIZ: restore sonrası kart borç↔ledger drift %.', v_drift;
  end if;

  -- 5) Settlement işaretleri sıyrıldı (payload'a bilerek dolu gönderilse bile).
  --    (Payload'daki tüm satırlar zaten null'dı; savunmayı ayrıca kanıtla:
  --    bir kopya satıra sahte settlement bas, tek-tablo restore değil TAM
  --    restore olduğundan yeniden yükle ve alanın null geldiğini gör.)
  if jsonb_array_length(coalesce(v_payload->'tables'->'card_expenses', '[]'::jsonb)) > 0 then
    v_report := public.restore_user_finance_data_tx(
      jsonb_set(v_payload, '{tables,card_expenses,0,current_settlement_id}',
                pg_catalog.to_jsonb('a1000000-0000-4000-8000-00000000dead'::uuid))
    );
    if exists (
      select 1 from public.card_expenses
      where user_id = v_user and current_settlement_id is not null
    ) then
      raise exception 'BAŞARISIZ: settlement işareti sıyrılmadı.';
    end if;
  end if;

  -- 5b) ESKİ-YEDEK uyumluluğu: şemadan önce alınmış yedekte yeni kolonlar
  --     yoktur (ör. bugünkü budgets.limit_anchor). Eksik kolon DEFAULT almalı
  --     — populate'in NULL'u ezmesine izin verilmediğinin doğrudan kanıtı.
  if jsonb_array_length(coalesce(v_payload->'tables'->'budgets', '[]'::jsonb)) > 0 then
    v_report := public.restore_user_finance_data_tx(
      jsonb_set(v_payload, '{tables,budgets}',
        (select jsonb_agg(r - 'limit_anchor' - 'limit_anchor_value')
         from jsonb_array_elements(v_payload->'tables'->'budgets') r))
    );
    if exists (select 1 from public.budgets where user_id = v_user and limit_anchor is distinct from 'manual' and limit_anchor_value is null and limit_anchor is null) then
      raise exception 'BAŞARISIZ: eski-yedek kolon default''u uygulanmadı.';
    end if;
    if (select count(*) from public.budgets where user_id = v_user) <> (select n from _snapshot_counts where tbl = 'budgets') then
      raise exception 'BAŞARISIZ: eski-yedek budgets sayımı tutmadı.';
    end if;
    -- Son durumu tam payload'la geri getir (sonraki bloklar tam veri bekler).
    perform public.restore_user_finance_data_tx(v_payload);
  end if;

  raise notice 'transactional_restore: round-trip + rollback + sıyırma geçti';
end $$;

-- 6) Çapraz-parent sızıntı reddi: yabancı kartın id'sine işaret eden harcama
--    (parent payload'da yok, DB'de user2'ye ait) tüm restore'u geri alır.
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_foreign_card uuid := 'f0f0f0f0-0000-4000-8000-000000000001';
  v_before bigint;
  v_after bigint;
begin
  execute 'reset role';
  -- Yabancı kullanıcı FK hedefi olarak var olmalı (token kolonları boş string:
  -- NULL kalırsa GoTrue şema hatası verir — seed.sql gotcha'sı; burada login
  -- yok ama kalıbı bozmayalım).
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at)
  values ('22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'sizinti@test.local', 'x', now(), '', '', '', '', '{}', '{}', now(), now());
  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_foreign_card, '22222222-2222-2222-2222-222222222222', 'Yabancı', 'Sızıntı Kartı', 'kredi_karti', 1000, 1, 10);
  execute 'set local role authenticated';

  select count(*) into v_before from public.card_expenses where user_id = v_user;

  begin
    perform public.restore_user_finance_data_tx(jsonb_build_object(
      'schema', 'financeproject-v2',
      'tables', jsonb_build_object(
        'card_expenses', jsonb_build_array(jsonb_build_object(
          'id', 'f0f0f0f0-0000-4000-8000-000000000002',
          'user_id', v_user,
          'card_id', v_foreign_card,
          'spent_at', current_date,
          'amount', 10,
          'description', 'sizinti denemesi',
          'category', 'Diğer',
          'status', 'posted'
        ))
      )
    ));
    raise exception 'BAŞARISIZ: yabancı parent''lı restore kabul edildi.';
  exception
    when raise_exception then
      if sqlerrm like 'BAŞARISIZ%' then raise; end if;
  end;

  select count(*) into v_after from public.card_expenses where user_id = v_user;
  if v_after <> v_before then
    raise exception 'BAŞARISIZ: sızıntı reddi sonrası veri değişti (% → %).', v_before, v_after;
  end if;

  raise notice 'transactional_restore: çapraz-parent reddi geçti';
end $$;

rollback;
