begin;
insert into auth.users(id, email) values ('22222222-2222-2222-2222-222222222222', 'personal-sms-other@example.test') on conflict (id) do nothing;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  u uuid := auth.uid();
  bank uuid;
  receivable uuid;
  borrowed uuid;
  other_debt uuid;
  other_movement uuid;
  classified uuid;
  automatic uuid;
  sms_in uuid;
  sms_out uuid;
  sms_time timestamptz := now() - interval '5 days';
  req uuid := gen_random_uuid();
  args jsonb;
  balance numeric;
  events bigint;
  test_case jsonb;
begin
  insert into public.cards(user_id, bank_name, card_name, card_type, account_number, current_balance)
  values (u, 'Test', 'SMS eşleme hesabı', 'banka_karti', '6278143000', 1000) returning id into bank;
  insert into public.debts(user_id, person_name, direction, value_type, amount, estimated_value_try, status)
  values (u, 'Test alacak', 'borç_verdim', 'TRY', 1, 100, 'açık') returning id into receivable;
  insert into public.debts(user_id, person_name, direction, value_type, amount, estimated_value_try, status)
  values (u, 'Test borç', 'borç_aldım', 'TRY', 1, 80, 'açık') returning id into borrowed;
  insert into public.debts(user_id, person_name, direction, value_type, amount, estimated_value_try, status)
  values ('22222222-2222-2222-2222-222222222222', 'Başka kişi', 'borç_aldım', 'TRY', 1, 80, 'açık') returning id into other_debt;
  insert into public.transaction_history(user_id, type, title, amount, source_table, source_id, note)
  values ('22222222-2222-2222-2222-222222222222', 'transfer', 'Başka kişiye EFT gonderimi', 80, 'cards', bank,
    'SMS otomasyonu ile kaydedildi.') returning id into other_movement;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.record_sms_account_movement('6278143000', 30.25, 'in', 'Farklı kişi', sms_time, 'FAST', u, 'test-sms-link-in');
  perform public.record_sms_account_movement('6278143000', 80, 'out', 'Farklı kişi', sms_time, 'FAST', u, null);
  perform public.record_sms_account_movement('6278143000', 25, 'in', 'Test alacak', sms_time, 'FAST', u, 'test-sms-auto');
  perform public.record_sms_account_movement('6278143000', 10, 'in', 'Farklı kişi', sms_time, 'FAST', u, 'test-sms-salary');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  select id into strict sms_in from public.transaction_history where source_id = bank and source_event_id = 'test-sms-link-in';
  select id into strict sms_out from public.transaction_history where user_id = u and source_id = bank and title like '% gonderimi';
  select id into strict automatic from public.transaction_history where source_id = bank and source_event_id = 'test-sms-auto';
  select id into strict classified from public.transaction_history where source_id = bank and source_event_id = 'test-sms-salary';
  perform public.classify_account_income(classified, 'salary');
  select current_balance into balance from public.cards where id = bank;
  select count(*) into events from public.account_ledger where card_id = bank;

  if (select array_agg(id) from public.list_personal_debt_sms_movements(receivable)) is distinct from array[sms_in]
    or (select array_agg(id) from public.list_personal_debt_sms_movements(borrowed)) is distinct from array[sms_out]
    or exists (select 1 from public.list_personal_debt_sms_movements(other_debt)) then
    raise exception 'SMS listesi yön, sahip, otomatik eşleşme veya sınıfı yanlış süzdü';
  end if;

  for test_case in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_array(receivable, sms_out, 10, 'SMS hareketinin yönüne uygun açık TL borcu veya alacağı bulunamadı.'),
    jsonb_build_array(borrowed, other_movement, 10, 'SMS hesap hareketi bulunamadı.'),
    jsonb_build_array(other_debt, sms_out, 10, 'SMS hareketinin yönüne uygun açık TL borcu veya alacağı bulunamadı.'),
    jsonb_build_array(receivable, sms_in, 30.26, 'Kaydedilecek tutar SMS hareketinin tutarını aşamaz ve kuruş hassasiyetinde olmalı.'),
    jsonb_build_array(receivable, automatic, 10, 'Bu SMS zaten bir borç veya alacakla otomatik eşleştirilmiş.'),
    jsonb_build_array(receivable, classified, 10, 'Bu para girişi farklı bir seçimle zaten sınıflandırıldı.')
  )) loop
    begin
      perform public.submit_finance_payment(gen_random_uuid(), 'link_personal_debt_sms_movement',
        jsonb_build_object('p_debt_id', test_case->>0, 'p_movement_id', test_case->>1, 'p_amount', test_case->>2));
      raise exception 'Geçersiz SMS bağlantısı kabul edildi: %', test_case;
    exception when raise_exception then
      if sqlerrm <> test_case->>3 then raise; end if;
    end;
  end loop;

  args := jsonb_build_object('p_debt_id', receivable, 'p_movement_id', sms_in, 'p_amount', 30.25);
  perform public.submit_finance_payment(gen_random_uuid(), 'link_personal_debt_sms_movement', args);
  if not exists (select 1 from public.debts where id = receivable and status = 'açık' and estimated_value_try = 44.75)
    or not exists (select 1 from public.account_income_labels where movement_id = sms_in and debt_id = receivable and debt_amount = 30.25)
    or exists (select 1 from public.list_personal_debt_sms_movements(receivable)) then
    raise exception 'Kısmi tahsilat veya gelir sınıfı kaydedilmedi';
  end if;

  args := jsonb_build_object('p_debt_id', borrowed, 'p_movement_id', sms_out, 'p_amount', 80);
  perform public.submit_finance_payment(req, 'link_personal_debt_sms_movement', args);
  perform public.submit_finance_payment(req, 'link_personal_debt_sms_movement', args);
  if not exists (select 1 from public.debts where id = borrowed and status = 'kapandı') then
    raise exception 'Tam ödeme borcu kapatmadı';
  end if;
  update public.debts set status = 'açık' where id = borrowed;
  if exists (select 1 from public.list_personal_debt_sms_movements(borrowed)) then raise exception 'Tüketilen SMS yeniden listelendi'; end if;
  begin
    perform public.submit_finance_payment(gen_random_uuid(), 'link_personal_debt_sms_movement', args);
    raise exception 'Yeni istek kimliğiyle aynı hareket tekrar kullanıldı';
  exception when raise_exception then
    if sqlerrm <> 'Bu SMS hareketi zaten bir borç kaydına bağlanmış.' then raise; end if;
  end;

  if (select current_balance from public.cards where id = bank) is distinct from balance
    or (select count(*) from public.account_ledger where card_id = bank) <> events
    or (select count(*) from public.transaction_history where type = 'debt' and occurred_at = sms_time
      and source_event_id in ('income-match:' || sms_in::text, 'sms-debt-match:' || sms_out::text)) <> 2 then
    raise exception 'SMS bağlantısı bakiye/ledger yazdı veya geçmişi çoğalttı';
  end if;
  if has_function_privilege('anon', 'public.list_personal_debt_sms_movements(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.link_personal_debt_sms_movement(uuid,uuid,uuid,numeric)', 'EXECUTE') then
    raise exception 'SMS eşleme işlevlerinin yetkileri fazla geniş';
  end if;
end;
$$;
rollback;
