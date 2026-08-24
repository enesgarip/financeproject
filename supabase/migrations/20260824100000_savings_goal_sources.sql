-- Birikim hedeflerini varlıklara/hesaplara bağlama (hedef takip kaynağı).
--
-- Sorun: "Borsa: 1M TL" hedefinin biriken tutarı elle giriliyordu; portföy her
-- gün değişse de hedef, kullanıcı yeniden yazana kadar aynı sayıda kalıyordu.
--
-- Çözüm: hedef (ya da karma hedefin bir bileşeni) bir veya birden çok kaynağa
-- bağlanır; biriken tutar OKUMA ANINDA kaynaklardan türetilir, saklanmaz.
-- Türetme saf TS ikizinde (`src/utils/goalSources.ts`) yapılır — canlı BIST
-- fiyatı ve kur snapshot'ı yalnız client'ta olduğu için DB bu değeri
-- hesaplayamaz. Bu yüzden bağlı satırların `current_amount` kolonu 0'a çekilir:
-- okunmayan, bayat bir sayı bırakmak "hangisi doğru?" sorusunu doğuruyordu
-- (aynı gerekçe karma hedef sayaçlarında da uygulanmıştı — Faz D2).

create table public.savings_goal_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  -- NULL = hedefin kendisine bağlı; dolu = karma hedefin tek bir bileşenine.
  component_id uuid null,
  kind text not null check (kind in ('asset', 'asset_category', 'all_assets', 'bank_account', 'kasa_bucket')),
  asset_id uuid null references public.assets(id) on delete cascade,
  asset_category text null,
  card_id uuid null references public.cards(id) on delete cascade,
  bucket_id uuid null references public.kasa_buckets(id) on delete cascade,
  sort_order int not null default 0,
  -- Her kind'ın TEK bir referansı olur; yanlış kolon dolduğunda satır sessizce
  -- "hiçbir şeye bağlı olmayan kaynak" olarak kalmasın.
  constraint savings_goal_sources_ref_matches_kind check (
    (kind = 'asset' and asset_id is not null and asset_category is null and card_id is null and bucket_id is null)
    or (kind = 'asset_category' and asset_category is not null and asset_id is null and card_id is null and bucket_id is null)
    or (kind = 'all_assets' and asset_id is null and asset_category is null and card_id is null and bucket_id is null)
    or (kind = 'bank_account' and card_id is not null and asset_id is null and asset_category is null and bucket_id is null)
    or (kind = 'kasa_bucket' and bucket_id is not null and asset_id is null and asset_category is null and card_id is null)
  )
);

-- Bileşen bağı yalnız KENDİ hedefinin bileşenine kurulabilsin: bileşik FK
-- (component_id, goal_id) bunu veritabanı seviyesinde garanti eder. MATCH
-- SIMPLE olduğu için component_id NULL iken kısıt aranmaz (hedef seviyesi bağ).
alter table public.savings_goal_components
  add constraint savings_goal_components_id_goal_key unique (id, goal_id);

alter table public.savings_goal_sources
  add constraint savings_goal_sources_component_fk
  foreign key (component_id, goal_id)
  references public.savings_goal_components (id, goal_id)
  on delete cascade;

create index savings_goal_sources_user_idx on public.savings_goal_sources (user_id);
create index savings_goal_sources_goal_idx on public.savings_goal_sources (goal_id);

-- Aynı kaynağı iki kez bağlamak tutarı ÇİFT sayardı. component_id ve referans
-- kolonları nullable olduğu için tekillik normalize edilmiş ifade üzerinden.
create unique index savings_goal_sources_unique_idx on public.savings_goal_sources (
  goal_id,
  coalesce(component_id, '00000000-0000-0000-0000-000000000000'::uuid),
  kind,
  coalesce(asset_id::text, asset_category, card_id::text, bucket_id::text, '')
);

alter table public.savings_goal_sources enable row level security;

create policy "own rows" on public.savings_goal_sources
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_updated_at
  before update on public.savings_goal_sources
  for each row
  execute function public.set_updated_at();

-- Migration'dan kurulan ortamda (yerel docker, kurtarma) yetki gelmez.
grant select, insert, update, delete on table public.savings_goal_sources to authenticated;
