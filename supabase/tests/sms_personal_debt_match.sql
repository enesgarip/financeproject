-- Gelen/giden hesap SMS'i ↔ açık kişisel alacak/borç eşlemesi.
--
-- Riskler:
--  1) Eşleşen alacak SMS kredisinin üstüne ikinci kez hesaba yazılırsa çift
--     sayım (asıl vaka): bakiye yalnız SMS tutarı kadar artmalı.
--  2) Belirsiz aday (iki "Ali") ya da büyük tutar tahminle kapatılmamalı.
--  3) Retry aynı olay kimliğiyle kaydı ikinci kez düşürmemeli.
--  4) Elle "Tahsil et" + p_skip_account_move hesaba dokunmamalı.
--
-- service_role tablolara doğrudan bakamaz (yalnız dar RPC'yi çalıştırır);
-- RPC dönüşleri geçici tabloda biriktirilir, doğrulama owner olarak yapılır.
begin;

insert into public.cards (id, user_id, bank_name, card_name, card_type, account_number, current_balance)
values ('b0000000-0000-4000-8000-000000000011', '11111111-1111-1111-1111-111111111111',
        'Test', 'SMS alacak', 'banka_karti', '4230-88888888-001', 1000);

insert into public.debts (id, user_id, person_name, direction, value_type, currency, amount, estimated_value_try, status) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Furkan Kurtuldu', 'borç_verdim', 'TRY', 'TRY', 1, 8000, 'açık'),
  ('d0000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Şeyma', 'borç_verdim', 'TRY', 'TRY', 1, 2000, 'açık'),
  ('d0000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'Veli', 'borç_verdim', 'TRY', 'TRY', 1, 500, 'açık'),
  ('d0000000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', 'Veli', 'borç_verdim', 'TRY', 'TRY', 1, 700, 'açık'),
  ('d0000000-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111', 'Mehmet', 'borç_verdim', 'TRY', 'TRY', 1, 300, 'açık'),
  ('d0000000-0000-4000-8000-000000000006', '11111111-1111-1111-1111-111111111111', 'Halil', 'borç_verdim', 'TRY', 'TRY', 1, 150, 'açık'),
  ('d0000000-0000-4000-8000-000000000007', '11111111-1111-1111-1111-111111111111', 'Ayşe Yılmaz', 'borç_aldım', 'TRY', 'TRY', 1, 1200, 'açık');

create temp table _sms_out (step text primary key, payload jsonb);
grant all on table _sms_out to service_role;

set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- 1) Tam eşleşme: FAST 8.000 "FURKAN KURTULDU".
  insert into _sms_out values ('full', public.record_sms_account_movement('88888888-001', 8000, 'in', 'FURKAN KURTULDU',
    '2026-09-08T18:33:58+03:00', 'FAST', v_user, 'sms-debt-1'));
  -- 1b) Retry aynı olay.
  insert into _sms_out values ('retry', public.record_sms_account_movement('88888888-001', 8000, 'in', 'FURKAN KURTULDU',
    '2026-09-08T18:33:58+03:00', 'FAST', v_user, 'sms-debt-1'));
  -- 2) Aksan katlama + kısmi: "SEYMA DEMIR" 1.200 → Şeyma 2000→800.
  insert into _sms_out values ('partial', public.record_sms_account_movement('88888888-001', 1200, 'in', 'SEYMA DEMIR',
    '2026-09-08T19:00:00+03:00', 'FAST', v_user, 'sms-debt-2'));
  -- 3) Belirsiz: iki açık "Veli" (seed'de ayrıca bir "Ali" var).
  insert into _sms_out values ('ambiguous', public.record_sms_account_movement('88888888-001', 500, 'in', 'VELI DEMIR',
    '2026-09-08T19:10:00+03:00', 'FAST', v_user, 'sms-debt-3'));
  -- 4) Tutar kayıttan büyük: Mehmet 300, gelen 1.000.
  insert into _sms_out values ('too_large', public.record_sms_account_movement('88888888-001', 1000, 'in', 'MEHMET KAYA',
    '2026-09-08T19:20:00+03:00', 'FAST', v_user, 'sms-debt-4'));
  -- 4b) Tolerans içi fazla (300 kayıt, 304 gelen; tol max(5, %1)=5) → tam kapama.
  insert into _sms_out values ('tolerance', public.record_sms_account_movement('88888888-001', 304, 'in', 'MEHMET KAYA',
    '2026-09-08T19:25:00+03:00', 'FAST', v_user, 'sms-debt-4b'));
  -- 5) Tam kelime: "HALIL AKIN" → Halil; "veli"/"ali" alt dizesi Veli/Ali kayıtlarını yakalamamalı.
  insert into _sms_out values ('word', public.record_sms_account_movement('88888888-001', 150, 'in', 'HALIL AKIN',
    '2026-09-08T19:30:00+03:00', 'FAST', v_user, 'sms-debt-5'));
  -- 6) Simetrik: giden EFT "AYSE YILMAZ" 1.200 → borç_aldım kapanır.
  insert into _sms_out values ('outgoing', public.record_sms_account_movement('88888888-001', 1200, 'out', 'AYSE YILMAZ',
    '2026-09-08T19:40:00+03:00', 'EFT', v_user, 'sms-debt-6'));
end $$;

reset role;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_out jsonb;
  v_prev jsonb;
  v_balance numeric;
  v_status text;
  v_value numeric;
  v_count int;
begin
  -- 1) Tam eşleşme: alacak kapandı, geçmiş satırı olay kimliğini taşır.
  select payload into v_out from _sms_out where step = 'full';
  if (v_out->'matched_debt'->>'closed')::boolean is distinct from true then
    raise exception 'FAIL tam eşleşme: matched_debt.closed beklenirdi, %', v_out;
  end if;
  select status into v_status from public.debts where id = 'd0000000-0000-4000-8000-000000000001';
  if v_status <> 'kapandı' then
    raise exception 'FAIL alacak kapanmadı (%).', v_status;
  end if;
  if (v_out->>'current_balance')::numeric <> 9000 then
    raise exception 'FAIL çift sayım: bakiye 9000 beklenirdi, %', v_out->>'current_balance';
  end if;
  select count(*) into v_count from public.transaction_history
  where user_id = v_user and source_table = 'debts' and source_event_id = 'sms-debt-1';
  if v_count <> 1 then
    raise exception 'FAIL alacak geçmiş satırı: 1 beklenirdi, %', v_count;
  end if;

  -- 1b) Retry: replayed, bakiye sabit.
  select payload into v_out from _sms_out where step = 'retry';
  if (v_out->>'replayed')::boolean is distinct from true or (v_out->>'current_balance')::numeric <> 9000 then
    raise exception 'FAIL retry: replayed + 9000 beklenirdi, %', v_out;
  end if;

  -- 2) Kısmi: açık/800.
  select payload into v_out from _sms_out where step = 'partial';
  select status, estimated_value_try into v_status, v_value from public.debts where id = 'd0000000-0000-4000-8000-000000000002';
  if v_status <> 'açık' or v_value <> 800 or (v_out->'matched_debt'->>'remaining')::numeric <> 800 then
    raise exception 'FAIL kısmi tahsilat: açık/800 beklenirdi, %/% (%).', v_status, v_value, v_out;
  end if;

  -- 3) Belirsiz: eşleme yok, not var, kayıtlar açık.
  select payload into v_out from _sms_out where step = 'ambiguous';
  if v_out->'matched_debt' is distinct from 'null'::jsonb or coalesce(v_out->>'debt_note', '') not like '%2 acik kayit%' then
    raise exception 'FAIL belirsiz aday: eşleme olmamalıydı, %', v_out;
  end if;
  select count(*) into v_count from public.debts where person_name = 'Veli' and status = 'açık';
  if v_count <> 2 then
    raise exception 'FAIL belirsiz aday: kayıtlar açık kalmalıydı (%).', v_count;
  end if;

  -- 4) Büyük tutar: eşleme yok, not var.
  select payload into v_out from _sms_out where step = 'too_large';
  if v_out->'matched_debt' is distinct from 'null'::jsonb or coalesce(v_out->>'debt_note', '') not like '%tutar kayit degerinden%' then
    raise exception 'FAIL büyük tutar: eşleme olmamalıydı, %', v_out;
  end if;

  -- 4b) Tolerans içi → kapandı.
  select status into v_status from public.debts where id = 'd0000000-0000-4000-8000-000000000005';
  if v_status <> 'kapandı' then
    raise exception 'FAIL tolerans: Mehmet kapanmalıydı (%).', v_status;
  end if;

  -- 5) Tam kelime.
  select status into v_status from public.debts where id = 'd0000000-0000-4000-8000-000000000006';
  if v_status <> 'kapandı' then
    raise exception 'FAIL tam kelime: Halil kapanmalıydı (%).', v_status;
  end if;
  select count(*) into v_count from public.debts where person_name = 'Veli' and status = 'açık';
  if v_count <> 2 then
    raise exception 'FAIL tam kelime: "veli"/"ali" alt dizesi Veli/Ali kayıtlarını kapatmamalıydı (%).', v_count;
  end if;

  -- 6) Giden: borç kapandı, bakiye yalnız 1200 düştü.
  select payload into v_prev from _sms_out where step = 'word';
  select payload into v_out from _sms_out where step = 'outgoing';
  select status into v_status from public.debts where id = 'd0000000-0000-4000-8000-000000000007';
  if v_status <> 'kapandı' then
    raise exception 'FAIL giden eşleme: borç kapanmalıydı (%).', v_status;
  end if;
  if (v_out->>'current_balance')::numeric <> (v_prev->>'current_balance')::numeric - 1200 then
    raise exception 'FAIL giden eşleme: bakiye yalnız 1200 düşmeliydi (% → %).', v_prev->>'current_balance', v_out->>'current_balance';
  end if;
  select current_balance into v_balance from public.cards where id = 'b0000000-0000-4000-8000-000000000011';
  if v_balance <> (v_out->>'current_balance')::numeric then
    raise exception 'FAIL dönüş bakiyesi tabloyla uyuşmuyor (% / %).', v_balance, v_out->>'current_balance';
  end if;
end $$;

-- 7) Elle "Tahsil et" + p_skip_account_move: kayıt kapanır, bakiye değişmez.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_before numeric;
  v_after numeric;
  v_status text;
  v_note text;
begin
  select current_balance into v_before from public.cards where id = 'b0000000-0000-4000-8000-000000000011';
  perform public.settle_personal_debt('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000011', null, true);
  select current_balance into v_after from public.cards where id = 'b0000000-0000-4000-8000-000000000011';
  select status into v_status from public.debts where id = 'd0000000-0000-4000-8000-000000000003';
  if v_status <> 'kapandı' or v_after <> v_before then
    raise exception 'FAIL skip: kapandı + bakiye sabit beklenirdi (% / % → %).', v_status, v_before, v_after;
  end if;
  select note into v_note from public.transaction_history
  where source_table = 'debts' and source_id = 'd0000000-0000-4000-8000-000000000003';
  if v_note not like '%tekrar oynatilmadi%' then
    raise exception 'FAIL skip notu: %', v_note;
  end if;

  -- Varsayılan yol hâlâ hesaba yazar (regresyon): Veli #4 700 → +700.
  perform public.settle_personal_debt('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000011');
  select current_balance into v_after from public.cards where id = 'b0000000-0000-4000-8000-000000000011';
  if v_after <> v_before + 700 then
    raise exception 'FAIL varsayılan tahsilat: +700 beklenirdi (% → %).', v_before, v_after;
  end if;

  if has_function_privilege('authenticated', 'private.match_open_personal_debt(uuid,text,text,numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.settle_personal_debt_internal(uuid,uuid,uuid,numeric,boolean,timestamptz,text)', 'EXECUTE') then
    raise exception 'FAIL grant: private eşleme fonksiyonları authenticated tarafından çağrılamamalı.';
  end if;

  raise notice 'SMS ↔ kişisel alacak/borç eşleme regresyonu OK.';
end $$;

rollback;
