-- Bilgi amaçlı kayıtların CRUD/RLS, finansal etkisizlik ve yedek invariant'ları.
begin;

insert into auth.users (id, email) values
  ('7a130000-0000-4000-8000-000000000001', 'tracking-own@local.test'),
  ('7a130000-0000-4000-8000-000000000002', 'tracking-other@local.test');
insert into public.personal_tracking_entries (id, user_id, person_name, amount, occurred_on)
values ('7a130000-0000-4000-8000-000000000003', '7a130000-0000-4000-8000-000000000002', 'Başkasının kaydı', 99, current_date);

set local role authenticated;
set local request.jwt.claims to '{"sub":"7a130000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_user uuid := '7a130000-0000-4000-8000-000000000001';
  v_other uuid := '7a130000-0000-4000-8000-000000000002';
  v_id uuid := '7a130000-0000-4000-8000-000000000004';
  v_before jsonb;
  v_after jsonb;
  v_report jsonb;
  v_ledger_count bigint;
  v_count integer;
begin
  -- Banka/kart fixture'ı: takip ekleme/düzeltme/silme hiçbir ledger olayı üretmez.
  insert into public.cards (user_id, bank_name, card_name, card_type, current_balance)
  values (v_user, 'LOCAL-E2E-TRACKING', 'Hesap', 'banka_karti', 10000);
  select count(*) into v_ledger_count from public.account_ledger;
  v_before := public.fetch_finance_snapshot(now() - interval '24 months', (current_date - interval '24 months')::date, 120);

  insert into public.personal_tracking_entries (id, user_id, person_name, amount, occurred_on, note)
  values (v_id, v_user, 'Kardeşim', 2500.25, current_date, 'Geri istemediğim tamir ödemesi');
  update public.personal_tracking_entries set amount = 2600.35, note = 'Düzeltilen açıklama' where id = v_id;
  if not exists (select 1 from public.personal_tracking_entries where id = v_id and amount = 2600.35 and note = 'Düzeltilen açıklama') then
    raise exception 'Takip kaydı ekleme/düzeltme başarısız.';
  end if;
  v_after := public.fetch_finance_snapshot(now() - interval '24 months', (current_date - interval '24 months')::date, 120);
  if v_after is distinct from v_before or (select count(*) from public.account_ledger) <> v_ledger_count then
    raise exception 'Takip kaydı finans snapshot/ledger değerlerini değiştirdi.';
  end if;
  if exists (select 1 from public.debts) or exists (select 1 from public.transaction_history) then
    raise exception 'Takip kaydı borç/alacak veya para hareketi oluşturdu.';
  end if;

  if exists (select 1 from public.personal_tracking_entries where user_id = v_other) then
    raise exception 'RLS başka kullanıcının kaydını gösterdi.';
  end if;
  update public.personal_tracking_entries set amount = 1 where user_id = v_other;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'RLS başka kullanıcının kaydını değiştirdi.'; end if;
  delete from public.personal_tracking_entries where user_id = v_other;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'RLS başka kullanıcının kaydını sildi.'; end if;
  begin
    insert into public.personal_tracking_entries (user_id, person_name, amount, occurred_on)
    values (v_other, 'Yetkisiz', 1, current_date);
    raise exception 'Başka kullanıcı adına kayıt kabul edildi.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.personal_tracking_entries set user_id = v_other where id = v_id;
    raise exception 'Kaydın sahibi değiştirilebildi.';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.personal_tracking_entries (user_id, person_name, amount, occurred_on)
    values (v_user, '   ', 1, current_date);
    raise exception 'Boş kişi adı kabul edildi.';
  exception when check_violation then null;
  end;
  begin
    update public.personal_tracking_entries set amount = 0 where id = v_id;
    raise exception 'Sıfır tutar kabul edildi.';
  exception when check_violation then null;
  end;
  begin
    update public.personal_tracking_entries set amount = 'NaN'::numeric where id = v_id;
    raise exception 'NaN tutar kabul edildi.';
  exception when check_violation then null;
  end;

  delete from public.personal_tracking_entries where id = v_id;
  if exists (select 1 from public.personal_tracking_entries where id = v_id) then
    raise exception 'Kendi kaydını silme başarısız.';
  end if;
  if public.fetch_finance_snapshot(now() - interval '24 months', (current_date - interval '24 months')::date, 120) is distinct from v_before then
    raise exception 'Takip kaydını silmek finans snapshot değerlerini değiştirdi.';
  end if;
  raise notice 'GECTI: sadece takip CRUD + own-row RLS + finansal etkisizlik.';

  -- Yeni sarmal, önceki kredi notu restore/reset kapsamını da korur.
  v_report := public.restore_user_finance_data_tx(jsonb_build_object(
    'schema', 'financeproject-v2', 'tables', jsonb_build_object(
      'personal_tracking_entries', jsonb_build_array(jsonb_build_object(
        'id', v_id, 'user_id', v_other, 'person_name', 'Kardeşim',
        'amount', 2500.25, 'occurred_on', current_date, 'note', 'Tamir')),
      'credit_score_history', jsonb_build_array(jsonb_build_object('score', 1500, 'checked_on', current_date))
    )
  ));
  if (v_report->'tables'->>'personal_tracking_entries')::int <> 1
    or not exists (select 1 from public.personal_tracking_entries where id = v_id and user_id = v_user and amount = 2500.25 and note = 'Tamir')
    or not exists (select 1 from public.credit_score_history where score = 1500) then
    raise exception 'Transaksiyonel restore takip/kredi notu/sahiplik bilgisini korumadı.';
  end if;

  -- Hata INSERT aşamasında (reset'ten sonra) çıksa dahi tüm veri geri gelir.
  begin
    perform public.restore_user_finance_data_tx(jsonb_build_object(
      'schema', 'financeproject-v2', 'tables', jsonb_build_object(
        'personal_tracking_entries', jsonb_build_array(
          jsonb_build_object('id', v_id, 'person_name', 'A', 'amount', 1, 'occurred_on', current_date),
          jsonb_build_object('id', v_id, 'person_name', 'B', 'amount', 2, 'occurred_on', current_date)
        )
      )
    ));
    raise exception 'Yinelenen takip anahtarı kabul edildi.';
  exception when unique_violation then null;
  end;
  if not exists (select 1 from public.personal_tracking_entries where id = v_id and amount = 2500.25)
    or not exists (select 1 from public.credit_score_history where score = 1500) then
    raise exception 'Başarısız restore mevcut veriyi sildi.';
  end if;

  -- Bilinmeyen alanları sessizce düşürme.
  begin
    perform public.restore_user_finance_data_tx('{"schema":"financeproject-v2"}');
    raise exception 'Eksik tables alanı kabul edildi.';
  exception when raise_exception then
    if sqlerrm not like '%tables%eksik%' then raise; end if;
  end;
  if not exists (select 1 from public.personal_tracking_entries where id = v_id and amount = 2500.25) then
    raise exception 'Eksik yedek gövdesi mevcut takip kaydını sildi.';
  end if;
  begin
    perform public.restore_user_finance_data_tx('{"schema":"financeproject-v2","tables":{"personal_tracking_entries":[{"person_name":"A","amount":1,"occurred_on":"2026-10-13","future_field":1}]}}');
    raise exception 'Bilinmeyen alan kabul edildi.';
  exception when raise_exception then
    if sqlerrm not like '%tanınmayan kolon%' then raise; end if;
  end;
  perform public.restore_user_finance_data_tx('{"schema":"financeproject-v2","tables":{}}');
  if exists (select 1 from public.personal_tracking_entries) or exists (select 1 from public.credit_score_history) then
    raise exception 'Eski yedeği geri yükleme takip/kredi notu kayıtlarını sıfırlamadı.';
  end if;
  insert into public.personal_tracking_entries (user_id, person_name, amount, occurred_on)
  values (v_user, 'Reset denemesi', 1, current_date);
  perform public.reset_user_finance_data();
  if exists (select 1 from public.personal_tracking_entries) then raise exception 'Reset takip kayıtlarını temizlemedi.'; end if;
  raise notice 'GECTI: takip restore + sahiplik rewrite + rollback + eski yedek + reset.';
end;
$$;

reset role;
do $$
begin
  if not exists (select 1 from public.personal_tracking_entries where user_id = '7a130000-0000-4000-8000-000000000002' and amount = 99) then
    raise exception 'Başka kullanıcının kaydı reset/restore sırasında değişti.';
  end if;
  if has_function_privilege('authenticated', 'public.reset_user_finance_data_without_personal_tracking()', 'execute')
    or has_function_privilege('authenticated', 'public.restore_user_finance_data_tx_without_personal_tracking(jsonb)', 'execute') then
    raise exception 'İç reset/restore fonksiyonu dışarıya açık.';
  end if;
end;
$$;
rollback;
