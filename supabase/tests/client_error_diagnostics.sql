-- Teşhis ek alanı, idempotent INSERT ve own-row izolasyonu; para tabloları etkilenmez.
begin;
insert into auth.users(id,email) values
  ('ce200000-0000-4000-8000-000000000001','diagnostics-own@local.test'),
  ('ce200000-0000-4000-8000-000000000002','diagnostics-other@local.test');
insert into public.client_errors(user_id,source,message,fingerprint)
values ('ce200000-0000-4000-8000-000000000002','error','other','other');
set local role authenticated;
set local request.jwt.claims to '{"sub":"ce200000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare n integer; k text;
begin
  -- Eski istemcinin alanı göndermemesi uyumludur.
  insert into public.client_errors(source,message,fingerprint) values ('error','legacy','legacy');
  foreach k in array array['boundary','error','unhandledrejection','resource','security','network'] loop
    insert into public.client_errors(source,message,fingerprint,diagnostics)
    values(k,'technical',k,'{"version":1,"line":12,"column":5,"opaque":false}');
  end loop;
  insert into public.client_errors(id,source,message,fingerprint,diagnostics)
  values('ce200000-0000-4000-8000-000000000003','network','retry','retry','{}') on conflict(id) do nothing;
  insert into public.client_errors(id,source,message,fingerprint,diagnostics)
  values('ce200000-0000-4000-8000-000000000003','network','retry','retry','{}') on conflict(id) do nothing;
  select count(*) into n from public.client_errors where fingerprint='retry';
  if n <> 1 then raise exception 'UUID retry çoğaldı'; end if;
  if exists(select 1 from public.client_errors where fingerprint='other') then raise exception 'Başka kullanıcının kaydı okundu'; end if;
  begin
    insert into public.client_errors(user_id,source,message,fingerprint)
    values ('ce200000-0000-4000-8000-000000000002','error','spoof','spoof');
    raise exception 'Başka kullanıcı adına kayıt açıldı';
  exception when insufficient_privilege then null; end;
  begin
    update public.client_errors set message='edited' where fingerprint='retry';
    raise exception 'Hata kaydı düzenlenebildi';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.client_errors(source,message,fingerprint,diagnostics) values('error','large','large',jsonb_build_object('x',repeat('x',32769)));
    raise exception 'Sınırsız bağlam kabul edildi';
  exception when check_violation then null; end;
  begin
    insert into public.client_errors(source,message,fingerprint,diagnostics) values('error','array','array','[]');
    raise exception 'Bağlam nesne değil';
  exception when check_violation then null; end;
  delete from public.client_errors where fingerprint='other';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Başkasının kaydı silindi'; end if;
  delete from public.client_errors where fingerprint='retry';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Kendi kaydı silinemedi'; end if;
end $$;
rollback;
