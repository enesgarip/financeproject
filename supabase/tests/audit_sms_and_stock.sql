begin;
-- Otomasyon RPC'si kullanıcı/anon rollerine açılmamalı.
do $$ begin
  if has_function_privilege('authenticated', 'public.resolve_sms_card_alias(text,uuid)', 'execute')
     or has_function_privilege('anon', 'public.resolve_sms_card_alias(text,uuid)', 'execute') then
    raise exception 'SMS çözümleme kullanıcı rollerine açılmış.';
  end if;
end $$;
select set_config('test.sms_digits', (
  select a.last_four_digits from public.card_aliases a join public.cards c on c.id=a.card_id
  where a.user_id='11111111-1111-1111-1111-111111111111' and c.card_type='kredi_karti' limit 1
), true);
set local role service_role;
do $$ declare v_count int; begin
  select count(*) into v_count from public.resolve_sms_card_alias(current_setting('test.sms_digits'), '11111111-1111-1111-1111-111111111111');
  if v_count <> 1 then raise exception 'Servis rolü kartı çözemedi: %', v_count; end if;
  select count(*) into v_count from public.resolve_sms_card_alias(current_setting('test.sms_digits'), '22222222-2222-2222-2222-222222222222');
  if v_count <> 0 then raise exception 'Başka sahibin kartı döndü.'; end if;
end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- Yetkisiz EXECUTE yukarıda ACL üzerinden doğrulandı. Yerel Postgres imajı
-- rol değişiminden sonra bu izinsiz çağrının EXCEPTION bloğunda SIGSEGV üretiyor.
do $$ begin
  begin
    insert into public.stock_trades(user_id,symbol,kind,trade_date,quantity,unit_price,source)
    values (auth.uid(),'AUDTEST','buy',current_date+10,1,1,'manual');
    raise exception 'Gelecek tarih kabul edildi.';
  exception when invalid_datetime_format then null;
  end;
end $$;
rollback;
