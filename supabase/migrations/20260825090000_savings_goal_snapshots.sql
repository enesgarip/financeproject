-- Hedefin günlük değer fotoğrafı (Canlı Sayılar turu, PR-0).
--
-- Sorun: hedefin GEÇMİŞ değeri hiçbir yerde yok — kasa kovası yalnız güncel
-- rezervi (`reserved_amount` + `last_contribution_month`), net_worth_snapshots
-- yalnız kırılımsız toplamı tutuyor. "Gerçekleşen tempo" ve varış tahmini
-- ("bu gidişle ~Mart 2028", PR-4) tarihçe olmadan kurulamaz.
--
-- Çözüm: net değer fotoğrafının hedef bazlısı. Günde bir kez, client'ta
-- türetilen biriken tutar yazılır — kaynağa bağlı hedefin doğru değeri canlı
-- kur/BIST fiyatı istediği için DB bu seriyi kendisi üretemez (aynı gerekçe:
-- 20260824100000_savings_goal_sources.sql). Tutar hedefin KENDİ birimindedir:
-- TRY hedefte TL, gram/çeyrek hedefte miktar, karma hedefte ulaşan bileşen
-- sayısı. Yazım app/useDailyNetWorthSnapshot'ta; okuma tarafı PR-4'te gelir.
--
-- reset_user_finance_data bu tabloyu saymaz: goal_id FK'sı cascade olduğu için
-- savings_goals silinince fotoğraflar da gider (savings_goal_sources ile aynı
-- güvence).

create table public.savings_goal_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  snapshot_date date not null,
  -- Hedefin kendi biriminde (bkz. üst yorum); birikim negatif olamaz.
  amount numeric(14,2) not null check (amount >= 0),
  -- Gün başına tek nokta; client'ın upsert'i bu kısıt üzerinden idempotent.
  unique (goal_id, snapshot_date)
);

create index savings_goal_snapshots_user_idx on public.savings_goal_snapshots (user_id);

alter table public.savings_goal_snapshots enable row level security;

-- initPlan: (select auth.uid()) satır başına değil sorgu başına bir kez
-- hesaplanır — 20260824210000'deki toplu düzeltmenin dersi, yeni policy
-- baştan doğru desenle geliyor.
create policy "own rows" on public.savings_goal_snapshots
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger set_updated_at
  before update on public.savings_goal_snapshots
  for each row
  execute function public.set_updated_at();

-- Migration'dan kurulan ortamda (yerel docker, kurtarma) yetki gelmez.
grant select, insert, update, delete on table public.savings_goal_snapshots to authenticated;
