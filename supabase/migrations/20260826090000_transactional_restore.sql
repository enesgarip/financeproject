-- Transaksiyonel restore (KNOWN_RISKS #6 kapanışının R1 fazı).
--
-- Bugüne dek JSON geri yükleme iki bağımsız adımdı: reset RPC'si siler, sonra
-- istemci 30+ tabloyu REST'le tek tek ekler. Ortada patlayan her şey yarı-boş
-- bir veritabanı bırakıyordu (silme geri alınamazdı). Bu RPC tamamını TEK
-- transaction'a alır: herhangi bir adım patlarsa HİÇBİR ŞEY değişmez.
--
-- Sözleşme (istemci utils/backup.ts ile ikiz):
--  * Payload = parseBackup çıktısının {schema:'financeproject-v2', tables:{...}}
--    hali. v1 dönüşümü, settlement sıyırma ve yetim-taksit filtresi İSTEMCİDE
--    kalır (hızlı geri bildirim); RPC yine de savunma olarak settlement
--    kolonlarını null'lar.
--  * Sıra RESTORE_TABLE_ORDER'ın birebir SQL ikizidir (parent-first).
--    Payload'daki BİLİNMEYEN tablo adı ve satırlardaki BİLİNMEYEN kolon adı
--    HATADIR (sessiz düşürme yok) — jsonb_populate_recordset bilinmeyen
--    anahtarı sessizce yutar, o yüzden kolon kümesi information_schema'yla
--    önceden doğrulanır.
--  * user_id SUNUCUDA yeniden yazılır (auth.uid()) — yedek, hesap yeniden
--    açılsa da geçerli kalır.
--  * Ledger tabloları (card_ledger/account_ledger) BİLEREK restore edilmez
--    (mevcut tasarım: append-only tarihçe restore noktasından dürüstçe
--    yeniden başlar; cards insert'lerinin AFTER trigger'ları opening
--    olaylarını üretir). card_current_settlements da restore edilmez;
--    çocuklardaki current_settlement_id işaretleri null'lanır (guard trigger
--    INSERT'te dolu gelmesini zaten reddeder).
--  * DEFINER bağlamında RLS devrede olmadığından çapraz-kullanıcı parent
--    sızıntısı RPC içinde doğrulanır: restore edilen her çocuk-FK'nın parent
--    satırı bu kullanıcıya ait olmalı (T1 dersinin genellemesi).
--  * Dinamik SQL yalnız SABİT whitelist'ten gelen tablo adıyla ve %I ile
--    kurulur — injection yüzeyi yok.
--
-- İstemci geçişi R2'de: restoreBackup tek RPC çağrısına iner, RPC deploy
-- değilse (missing capability) eski REST yoluna düşer.

create or replace function public.restore_user_finance_data_tx(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  -- utils/backup.ts RESTORE_TABLE_ORDER'ın birebir ikizi (parent-first).
  v_order text[] := array[
    'cards','cars','expense_contexts','card_aliases','assets','loans',
    'savings_goals','budgets','kasa_buckets','wishlist_items','debts',
    'salary_history','gold_lots','net_worth_snapshots','savings_goal_snapshots',
    'card_statement_archives','card_statement_payments','car_reminders',
    'car_expenses','context_expenses','card_expenses','card_installments',
    'loan_installments','savings_goal_components','savings_goal_sources',
    'payments','transaction_history','account_reconciliations',
    'dismissed_upcoming_items','data_health_issue_acknowledgements',
    'push_subscriptions','notification_preferences'
  ];
  v_tbl text;
  v_rows jsonb;
  v_known_cols text[];
  v_present_cols text[];
  v_cols_csv text;
  v_bad_cols text[];
  v_count integer;
  v_report jsonb := '{}'::jsonb;
  v_payload_tables text[];
  v_ack_ids text[];
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if coalesce(p_payload->>'schema', '') <> 'financeproject-v2' then
    raise exception 'Tanınmayan yedek şeması: %', coalesce(p_payload->>'schema', '(yok)');
  end if;
  if jsonb_typeof(p_payload->'tables') is distinct from 'object' then
    raise exception 'Yedek gövdesi (tables) eksik ya da nesne değil.';
  end if;
  -- Tek kullanıcılık veri birkaç MB'ı geçmez; şişkin payload büyük ihtimalle
  -- yanlış dosyadır ve belleği anlamsız yormadan reddedilir.
  if pg_catalog.pg_column_size(p_payload) > 32 * 1024 * 1024 then
    raise exception 'Yedek dosyası beklenmedik kadar büyük (32 MB sınırı).';
  end if;

  -- Bilinmeyen tablo = hata (sessiz düşürme yok).
  select array_agg(k) into v_payload_tables
  from jsonb_object_keys(p_payload->'tables') k
  where k <> all (v_order);
  if v_payload_tables is not null then
    raise exception 'Yedekte tanınmayan tablo(lar): %', array_to_string(v_payload_tables, ', ');
  end if;

  -- Silme + ekleme AYNI transaction: reset kendi advisory lock'unu ve guard
  -- GUC'unu kurar; başarısızlıkta buradaki her şeyle birlikte geri alınır.
  perform public.reset_user_finance_data();

  foreach v_tbl in array v_order loop
    v_rows := p_payload->'tables'->v_tbl;
    if v_rows is null then
      continue;
    end if;
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception '% tablosunun satırları liste değil.', v_tbl;
    end if;
    if jsonb_array_length(v_rows) = 0 then
      continue;
    end if;

    -- Bilinmeyen kolon = hata: populate_recordset sessizce yutardı.
    select array_agg(c.column_name::text) into v_known_cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = v_tbl;

    select array_agg(distinct k) into v_present_cols
    from jsonb_array_elements(v_rows) r, jsonb_object_keys(r) k;

    select array_agg(k) into v_bad_cols
    from unnest(v_present_cols) k
    where k <> all (v_known_cols);
    if v_bad_cols is not null then
      raise exception '% tablosunda tanınmayan kolon(lar): % — yedek bu şemadan daha yeni olabilir.',
        v_tbl, array_to_string(v_bad_cols, ', ');
    end if;

    if v_tbl = 'data_health_issue_acknowledgements' then
      -- Özel yol: tablonun yazımı RPC'ye aittir; aynı semantik korunur.
      select array_agg(r->>'issue_id') into v_ack_ids
      from jsonb_array_elements(v_rows) r
      where coalesce(r->>'issue_id', '') <> '';
      if v_ack_ids is not null then
        perform public.acknowledge_data_health_issues(v_ack_ids);
        v_count := coalesce(array_length(v_ack_ids, 1), 0);
      else
        v_count := 0;
      end if;
    else
      -- user_id sunucuda yeniden yazılır; settlement işaretleri savunma
      -- olarak null'lanır (istemci zaten sıyırıyor; guard da reddederdi).
      select jsonb_agg(
               jsonb_set(r, '{user_id}', pg_catalog.to_jsonb(v_user_id))
               - 'current_settlement_id'
             )
      into v_rows
      from jsonb_array_elements(v_rows) r;

      -- Insert listesi = payload'da GEÇEN kolonlar: eksik kolonlar böylece
      -- kolon DEFAULT'unu alır (populate NULL basar ve default'u ezerdi —
      -- şemadan ESKİ bir yedek, sonradan eklenmiş not-null-default kolonlar
      -- yüzünden restore edilemez olurdu; REST yolunun davranışı korunur).
      select pg_catalog.string_agg(pg_catalog.quote_ident(k), ',')
      into v_cols_csv
      from unnest(v_present_cols) k
      where k <> 'current_settlement_id' or v_tbl not in ('card_expenses', 'card_installments');
      if position('user_id' in v_cols_csv) = 0 then
        v_cols_csv := v_cols_csv || ',user_id';
      end if;

      execute pg_catalog.format(
        'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)',
        v_tbl, v_cols_csv, v_cols_csv, v_tbl
      ) using v_rows;
      get diagnostics v_count = row_count;
    end if;

    v_report := v_report || jsonb_build_object(v_tbl, v_count);
  end loop;

  -- DEFINER = RLS yok: çocuk-FK'ların parent'ı BU kullanıcıya ait olmalı.
  -- Payload kendi export'uysa parent'lar da yazıldı ve bu kontroller bedava
  -- geçer; kırpılmış/elle oynanmış payload başkasının satırına tutunamaz.
  perform private.assert_restored_parents_owned(v_user_id);

  return jsonb_build_object('ok', true, 'tables', v_report);
end;
$$;

-- Çapraz-kullanıcı parent doğrulaması: restore edilen kritik FK zinciri.
create or replace function private.assert_restored_parents_owned(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leak text;
begin
  select msg into v_leak from (
    select 'card_expenses.card_id' as msg from public.card_expenses c
      join public.cards p on p.id = c.card_id
      where c.user_id = p_user and p.user_id <> p_user limit 1
  ) q;
  if v_leak is null then
    select msg into v_leak from (
      select 'card_expenses.statement_archive_id' as msg from public.card_expenses c
        join public.card_statement_archives p on p.id = c.statement_archive_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'card_installments.card_expense_id' as msg from public.card_installments c
        join public.card_expenses p on p.id = c.card_expense_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'card_installments.statement_archive_id' as msg from public.card_installments c
        join public.card_statement_archives p on p.id = c.statement_archive_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'card_statement_payments.statement_archive_id' as msg from public.card_statement_payments c
        join public.card_statement_archives p on p.id = c.statement_archive_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'loan_installments.loan_id' as msg from public.loan_installments c
        join public.loans p on p.id = c.loan_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'savings_goal_components.goal_id' as msg from public.savings_goal_components c
        join public.savings_goals p on p.id = c.goal_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'kasa_buckets.goal_id' as msg from public.kasa_buckets c
        join public.savings_goals p on p.id = c.goal_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'payments.auto_source_card_id' as msg from public.payments c
        join public.cards p on p.id = c.auto_source_card_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'car_expenses.car_id' as msg from public.car_expenses c
        join public.cars p on p.id = c.car_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'context_expenses.context_id' as msg from public.context_expenses c
        join public.expense_contexts p on p.id = c.context_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;
  if v_leak is null then
    select msg into v_leak from (
      select 'savings_goal_sources.bucket_id' as msg from public.savings_goal_sources c
        join public.kasa_buckets p on p.id = c.bucket_id
        where c.user_id = p_user and p.user_id <> p_user limit 1
    ) q;
  end if;

  if v_leak is not null then
    raise exception 'Geri yükleme reddedildi: % başka kullanıcının satırına işaret ediyor (yedek dosyası bozuk ya da elle oynanmış).', v_leak;
  end if;
end;
$$;

revoke all on function private.assert_restored_parents_owned(uuid) from public, anon, authenticated;

revoke all on function public.restore_user_finance_data_tx(jsonb) from public, anon;
grant execute on function public.restore_user_finance_data_tx(jsonb) to authenticated;
