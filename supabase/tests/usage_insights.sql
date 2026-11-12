begin;

insert into auth.users (id, email) values
  ('ea300000-0000-4000-8000-000000000001', 'insights-owner@local.test'),
  ('ea300000-0000-4000-8000-000000000002', 'insights-other@local.test');
insert into public.cards (id, user_id, card_name, bank_name, card_type) values
  ('ea300000-0000-4000-8000-000000000003', 'ea300000-0000-4000-8000-000000000001', 'test', 'test', 'kredi_karti'),
  ('ea300000-0000-4000-8000-000000000004', 'ea300000-0000-4000-8000-000000000002', 'test', 'test', 'kredi_karti');

insert into public.sms_log (user_id, sms_type, status, amount, raw_sms) values
  ('ea300000-0000-4000-8000-000000000001', 'card_expense', 'success', 10, 'test'),
  ('ea300000-0000-4000-8000-000000000001', 'card_expense', 'success', null, 'queued foreign'),
  ('ea300000-0000-4000-8000-000000000001', 'account_movement', 'success', 10, 'test'),
  ('ea300000-0000-4000-8000-000000000001', 'unrecognized', 'error', null, 'test'),
  ('ea300000-0000-4000-8000-000000000002', 'account_movement', 'success', 10, 'other'),
  (null, 'unrecognized', 'error', null, 'unmatched');

insert into public.foreign_card_sms (
  user_id, card_id, created_at, native_amount, currency, description, spent_at, source_event_id,
  raw_sms, message_hash, completed_amount, completed_at
) values
  ('ea300000-0000-4000-8000-000000000001', 'ea300000-0000-4000-8000-000000000003', now() - interval '25 hours',
    10, 'USD', 'test', now(), 'waiting', 'test', repeat('1', 64), null, null),
  ('ea300000-0000-4000-8000-000000000001', 'ea300000-0000-4000-8000-000000000003', now(),
    10, 'USD', 'test', now(), 'completed', 'test', repeat('2', 64), 10, now()),
  ('ea300000-0000-4000-8000-000000000002', 'ea300000-0000-4000-8000-000000000004', now(),
    10, 'USD', 'other', now(), 'other', 'other', repeat('3', 64), null, null);

insert into public.usage_events (user_id, kind, subject)
values ('ea300000-0000-4000-8000-000000000002', 'page', '/analiz');

set local role authenticated;
set local request.jwt.claims to '{"sub":"ea300000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.usage_events (user_id, kind, subject, created_at)
select auth.uid(), 'page', '/', (date_trunc('day', now() at time zone 'Europe/Istanbul') - make_interval(days => n))
  at time zone 'Europe/Istanbul'
from unnest(array[0, 6, 7, 13, 14]) as d(n);

insert into public.usage_events (user_id, kind, subject, flow_id, source)
select auth.uid(), stage, action, flow_id::uuid, source
from (values
  ('opened', 'expense', 'ea300000-0000-4000-8000-000000000010', 'bottom-nav'),
  ('closed', 'expense', 'ea300000-0000-4000-8000-000000000010', null),
  ('opened', 'expense', 'ea300000-0000-4000-8000-000000000011', 'discovery'),
  ('attempted', 'expense', 'ea300000-0000-4000-8000-000000000011', null),
  ('failed', 'expense', 'ea300000-0000-4000-8000-000000000011', null),
  ('attempted', 'expense', 'ea300000-0000-4000-8000-000000000011', null),
  ('completed', 'expense', 'ea300000-0000-4000-8000-000000000011', null),
  ('opened', 'payment', 'ea300000-0000-4000-8000-000000000013', 'overview'),
  ('attempted', 'payment', 'ea300000-0000-4000-8000-000000000013', null),
  ('failed', 'payment', 'ea300000-0000-4000-8000-000000000013', null),
  ('attempted', 'reserve', null, 'goals')
) as e(stage, action, flow_id, source);

-- Eski istemci olayları genel sayaçta kalır, eşleştirilmiş akışlara karışmaz.
insert into public.usage_events (user_id, kind, subject) values (auth.uid(), 'opened', 'expense');

do $$
declare result jsonb := public.fetch_usage_insights(7); flow jsonb;
begin
  if result is null
     or result->'comparison' <> '{"active_days":2,"page_views":2,"completed":1,"failed":2}'::jsonb
     or result->'previous' <> '{"active_days":2,"page_views":2,"completed":0,"failed":0}'::jsonb
     or not (result->'rows' @> '[{"kind":"page","subject":"/","event_count":2,"active_days":2,"previous_count":2}]'::jsonb)
     or not (result->'rows' @> '[{"kind":"opened","subject":"expense","event_count":3}]'::jsonb) then
    raise exception 'Kullanım dönem sınırları veya eski olay sayımı hatalı';
  end if;

  select row into strict flow from jsonb_array_elements(result->'flows') as f(row) where row->>'subject' = 'expense';
  if flow <> '{"subject":"expense","opened":2,"submitted":1,"completed":1,"closed_before_submit":1,"failed":0,"recovered":1}'::jsonb
     or not (result->'flows' @> '[{"subject":"payment","failed":1}]'::jsonb)
     or not (result->'sources' @> '[{"subject":"expense","source":"bottom-nav","event_count":1},{"subject":"expense","source":"discovery","event_count":1},{"subject":"reserve","source":"goals","event_count":1}]'::jsonb) then
    raise exception 'Eşleştirilmiş akış, tekrar veya kaynak sayımı hatalı';
  end if;

  if result->'automation' <> '{"card_sms":1,"account_sms":1,"sms_errors":1,"foreign_completed":1,"foreign_pending":1,"foreign_pending_over_day":1}'::jsonb then
    raise exception 'SMS sayımı veya sahiplik sınırı hatalı';
  end if;
  if has_function_privilege('anon', 'public.fetch_usage_insights(integer)', 'EXECUTE')
     or public.fetch_usage_insights(90) is not null then
    raise exception 'İzin dışı özet isteği kabul edildi';
  end if;

  begin
    insert into public.usage_events (user_id, kind, subject, flow_id, source)
    values (auth.uid(), 'opened', 'expense', gen_random_uuid(), 'Serbest metin');
    raise exception 'Kaynak alanına serbest metin yazıldı';
  exception when check_violation then null; end;
  begin
    insert into public.usage_events (user_id, kind, subject, flow_id)
    values (auth.uid(), 'page', '/', gen_random_uuid());
    raise exception 'Sayfa açılışına akış kimliği yazıldı';
  exception when check_violation then null; end;
end $$;

rollback;
