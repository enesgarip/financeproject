-- RLS denetimi (güvenlik invariant'ı). Tek-kullanıcılı finans app'inde her
-- public tablo "yalnız sahibi okur/yazar" olmalı. Bu denetim üç ihlali yakalar
-- ve herhangi biri varsa EXCEPTION fırlatır (psql -v ON_ERROR_STOP=1 ile CI'ı kırar):
--   1. RLS kapalı public tablo (RLS olmadan policy işlevsiz → tüm satırlar açık)
--   2. RLS açık ama HİÇ policy yok (deny-all gibi görünür ama yeni migration'da
--      eklenen tablo unutulmuşsa erken yakalansın)
--   3. auth.uid() referansı OLMAYAN policy (qual/with_check ikisi de) = own-row
--      değil → potansiyel `using (true)` herkese-açık sızıntı
--
-- Migration'dan sonra (seed YOK) çalışır; `npm run db:audit:rls:local` veya CI.
do $$
declare
  rec record;
  violations text[] := '{}';
begin
  -- 1. RLS kapalı public tablolar
  for rec in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    violations := violations || format('  - RLS kapalı: %s', rec.relname);
  end loop;

  -- 2. RLS açık ama policy'siz tablolar
  for rec in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      )
  loop
    violations := violations || format('  - Policy yok: %s', rec.relname);
  end loop;

  -- 3. auth.uid() ile sınırlanmamış policy'ler (qual ve with_check ikisi de uid()
  --    içermiyorsa). '%uid()%' hem `auth.uid()` hem `(select auth.uid())` formunu yakalar.
  for rec in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') not like '%uid()%'
      and coalesce(with_check, '') not like '%uid()%'
  loop
    violations := violations || format('  - Own-row değil (uid() yok): %s.%s [%s]', rec.tablename, rec.policyname, rec.cmd);
  end loop;

  if array_length(violations, 1) > 0 then
    raise exception E'RLS denetimi BAŞARISIZ — % ihlal:\n%',
      array_length(violations, 1), array_to_string(violations, E'\n');
  end if;

  raise notice 'RLS denetimi OK: tüm public tablolar RLS açık + own-row (auth.uid()) policy korumalı.';
end $$;
