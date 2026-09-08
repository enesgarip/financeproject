-- Elle değerlenen varlıkların (BES, Araç, Fon, Diğer) değer tarihçesi.
--
-- Sorun: manuel varlık güncellemesi `transaction_history`'ye client'tan ikinci
-- bir çağrıyla, İŞARETLİ delta olarak yazılıyordu. Tablonun `amount >= 0`
-- kısıtı düşüşleri sessizce reddediyordu (hata yalnız console'a gidiyordu) —
-- listede yalnız "+" satırlar kalıyor, toplam kazanç hesaplansa yanlış çıkardı.
-- Ayrıca katkı payı (yatırılan) ile getiri (piyasa) ayrımı yoktu: BES'te
-- "ne zamandan ne zamana ne kazandım" bu ayrım olmadan söylenemez.
--
-- Çözüm (ledger deseni, bkz. account_ledger):
--  * `asset_value_events`: append-only; her satır önceki→yeni değeri (kuruş),
--    dönemde yatırılan katkıyı ve tarihi taşır. Getiri = Δdeğer − katkı.
--  * AFTER UPDATE trigger'ı manuel varlığın her değer değişimini olaya çevirir
--    (generic düzenleme formu dahil; iki client çağrısı sözleşme ihlali kapanır).
--    Auto-valued satırlar (günlük senkron) ve altın defteri toplamı HARİÇ.
--  * `update_asset_value` RPC'si tasarlanmış yol: değer + katkı + tarih + not
--    tek transaction'da; trigger'ı GUC ile susturup olayı kendisi yazar ve
--    dashboard akışı için pozitif tutarlı bir `transaction_history` satırı bırakır.
--  * Eski `type='asset'` "eski → yeni" başlıklı geçmiş satırları olaya taşınır
--    (yalnız artışlar vardı; düşüşler zaten hiç yazılamamıştı).

create table public.asset_value_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  value_before_kurus bigint not null check (value_before_kurus >= 0),
  value_after_kurus bigint not null check (value_after_kurus >= 0),
  -- Dönemde yatırılan (katkı payı, devlet katkısı vb.). Eksi = çekim.
  contribution_kurus bigint not null default 0,
  -- 'manual' = RPC/form; 'trigger' = doğrudan tablo güncellemesi; 'legacy' = taşınan.
  source text not null default 'manual' check (source in ('manual', 'trigger', 'legacy')),
  note text
);

create index asset_value_events_asset_idx on public.asset_value_events (asset_id, occurred_at desc);
create index asset_value_events_user_idx on public.asset_value_events (user_id);

alter table public.asset_value_events enable row level security;

create policy "own rows" on public.asset_value_events
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger set_updated_at
  before update on public.asset_value_events
  for each row
  execute function public.set_updated_at();

grant select, insert, update, delete on table public.asset_value_events to authenticated;

-- ── Trigger: manuel varlığın değer değişimi → olay ─────────────────────────
-- SECURITY DEFINER: RPC/migration bağlamında auth.uid() olmasa da yazabilsin;
-- user_id NEW satırından gelir, tenant sınırı aşılmaz.
create or replace function public.record_asset_value_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before bigint;
  v_after bigint;
begin
  if coalesce(current_setting('app.asset_event_suppress', true), '') = '1' then
    return new;
  end if;
  -- Yalnız iki tarafı da manuel olan satır: auto→manuel geçişi kazanç değildir.
  if new.auto_valued or old.auto_valued then
    return new;
  end if;
  if new.source = 'gold_ledger' or old.source = 'gold_ledger' then
    return new;
  end if;

  v_before := round(coalesce(old.estimated_value_try, 0) * 100)::bigint;
  v_after := round(coalesce(new.estimated_value_try, 0) * 100)::bigint;
  if v_before = v_after then
    return new;
  end if;

  insert into public.asset_value_events (user_id, asset_id, occurred_at, value_before_kurus, value_after_kurus, contribution_kurus, source, note)
  values (new.user_id, new.id, now(), v_before, v_after, 0, 'trigger', null);
  return new;
end;
$$;

drop trigger if exists assets_value_events on public.assets;
create trigger assets_value_events
  after update on public.assets
  for each row execute function public.record_asset_value_event();

-- ── RPC: değer + katkı + tarih + not, tek transaction ───────────────────────
create or replace function public.update_asset_value(
  p_asset_id uuid,
  p_value numeric,
  p_contribution numeric default 0,
  p_occurred_at timestamptz default now(),
  p_note text default null
)
returns public.assets
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_asset public.assets%rowtype;
  v_updated public.assets%rowtype;
  v_value numeric(14, 2);
  v_contribution numeric(14, 2);
  v_before bigint;
  v_after bigint;
  v_contribution_kurus bigint;
  v_growth bigint;
  v_note text;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'Deger 0 veya daha buyuk olmali.';
  end if;

  v_value := round(p_value, 2);
  v_contribution := round(coalesce(p_contribution, 0), 2);

  select * into v_asset
  from public.assets
  where id = p_asset_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'Varlik bulunamadi.';
  end if;
  if v_asset.auto_valued then
    raise exception 'Canli fiyatla degerlenen varlik elle guncellenemez.';
  end if;
  if v_asset.source = 'gold_ledger' then
    raise exception 'Altin defteri toplami elle guncellenemez.';
  end if;

  v_before := round(v_asset.estimated_value_try * 100)::bigint;
  v_after := round(v_value * 100)::bigint;
  v_contribution_kurus := round(v_contribution * 100)::bigint;
  if v_before = v_after and v_contribution_kurus = 0 then
    raise exception 'Deger degismedi; kaydedecek bir sey yok.';
  end if;
  v_growth := v_after - v_before - v_contribution_kurus;

  -- Trigger ikinci bir olay yazmasın; olay burada, katkı ve tarihle yazılır.
  perform set_config('app.asset_event_suppress', '1', true);
  update public.assets
  set estimated_value_try = v_value, updated_at = now()
  where id = v_asset.id
  returning * into v_updated;
  perform set_config('app.asset_event_suppress', '', true);

  insert into public.asset_value_events (user_id, asset_id, occurred_at, value_before_kurus, value_after_kurus, contribution_kurus, source, note)
  values (v_user_id, v_asset.id, coalesce(p_occurred_at, now()), v_before, v_after, v_contribution_kurus, 'manual', nullif(btrim(coalesce(p_note, '')), ''));

  -- Dashboard akışı: tutar pozitif, yön/ayrıntı notta (TRANSACTION_HISTORY sözleşmesi).
  v_note := 'Deger ' || v_asset.estimated_value_try::text || ' TL -> ' || v_value::text || ' TL.'
    || case when v_contribution_kurus <> 0 then ' Katki: ' || v_contribution::text || ' TL.' else '' end
    || ' Getiri: ' || (v_growth / 100.0)::numeric(14, 2)::text || ' TL.'
    || case when nullif(btrim(coalesce(p_note, '')), '') is not null then ' Not: ' || btrim(p_note) else '' end;

  insert into public.transaction_history (user_id, occurred_at, type, title, amount, source_table, source_id, note)
  values (v_user_id, coalesce(p_occurred_at, now()), 'asset',
          v_asset.name || case when v_after >= v_before then ' degeri guncellendi' else ' degeri dustu' end,
          abs(v_after - v_before) / 100.0, 'assets', v_asset.id, v_note);

  return v_updated;
end;
$$;

revoke all on function public.update_asset_value(uuid, numeric, numeric, timestamptz, text) from public, anon;
grant execute on function public.update_asset_value(uuid, numeric, numeric, timestamptz, text) to authenticated;

-- ── Eski kayıtların taşınması ────────────────────────────────────────────────
-- Client başlığı `formatCurrency` ile "Ad: ₺140.000,00 → ₺150.000,00" yazıyordu.
-- Yalnız bu biçimdeki satırlar taşınır; al-sat satırları ("alındı/satıldı")
-- kapsam dışı. Eski satırlar akışta kalır (silinmez).
insert into public.asset_value_events (user_id, asset_id, occurred_at, value_before_kurus, value_after_kurus, contribution_kurus, source, note)
select
  h.user_id,
  h.source_id,
  h.occurred_at,
  round(replace(replace(m[1], '.', ''), ',', '.')::numeric * 100)::bigint,
  round(replace(replace(m[2], '.', ''), ',', '.')::numeric * 100)::bigint,
  0,
  'legacy',
  'Eski guncelleme kaydindan tasindi.'
from public.transaction_history h
join public.assets a on a.id = h.source_id and a.user_id = h.user_id
cross join lateral regexp_match(h.title, '₺([0-9.]+,[0-9]{2}) → ₺([0-9.]+,[0-9]{2})$') as m
where h.type = 'asset'
  and h.source_table = 'assets'
  and m is not null;
