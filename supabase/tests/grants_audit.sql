-- Grant denetimi (RLS denetiminin ikizi).
--
-- RLS policy'si yetkisiz tabloda ÖLÜ KODdur: PostgreSQL önce grant'e bakar,
-- yetki yoksa policy hiç çalışmaz ve istemci "permission denied" alır.
-- 2026-07-27'de tam bu drift yakalandı: `cards`, `card_expenses`, `payments`
-- gibi erken tablolar üretimde arayüzden oluşturulduğu için yetkiliydi, ama
-- migration'larda `grant` satırı yoktu → migration'lardan kurulan her ortam
-- (yerel docker, felaket kurtarma sonrası yeni proje) bozuktu.
--
-- Invariant: bir tabloda `authenticated` için X komutuna policy varsa,
-- `authenticated` o tabloda X yetkisine de sahip olmalı.
--
-- Migration'dan sonra çalışır (seed gerekmez); `npm run db:audit:grants:local`
-- veya CI. İhlalde EXCEPTION → psql -v ON_ERROR_STOP=1 ile kırmızı.

do $$
declare
  rec record;
  violations text[] := '{}';
begin
  for rec in
    with policy_cmds as (
      select p.tablename, needed.cmd as needed
      from pg_policies p
      cross join lateral unnest(
        case p.cmd when 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] else array[p.cmd] end
      ) as needed(cmd)
      where p.schemaname = 'public'
        and ('authenticated' = any (p.roles) or 'public' = any (p.roles))
    )
    select distinct pc.tablename, pc.needed
    from policy_cmds pc
    where not exists (
      select 1
      from information_schema.role_table_grants g
      where g.grantee = 'authenticated'
        and g.table_schema = 'public'
        and g.table_name = pc.tablename
        and g.privilege_type = pc.needed
    )
    order by pc.tablename, pc.needed
  loop
    violations := violations || format(
      '  - %s: "%s" policy''si var ama authenticated rolunde %s yetkisi YOK (policy olu kod)',
      rec.tablename, rec.needed, rec.needed
    );
  end loop;

  if array_length(violations, 1) > 0 then
    raise exception E'Grant/policy tutarsizligi (% adet):\n%',
      array_length(violations, 1), array_to_string(violations, E'\n');
  end if;

  raise notice 'Grant denetimi temiz: her policy karsiliginda yetki var.';
end $$;
