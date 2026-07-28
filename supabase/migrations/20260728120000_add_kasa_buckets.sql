-- Kasa modu: banka bakiyesini zihinsel kovalara (acil fon, vergi, tatil...) ayırma.
-- Planlama katmanıdır — gerçek bakiyeyi/ledger'ı DEĞİŞTİRMEZ; yalnız "gerçek
-- harcanabilir = likit − rezerve kovalar" hesabını besler. Tek kullanıcılı app
-- ama cihazlar arası (telefon/masaüstü) senkron olsun diye localStorage yerine tablo.
create table public.kasa_buckets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  reserved_amount numeric not null default 0 check (reserved_amount >= 0),
  sort_order int not null default 0,
  note text null
);

create index kasa_buckets_user_idx on public.kasa_buckets (user_id);

alter table public.kasa_buckets enable row level security;

create policy "own rows" on public.kasa_buckets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_updated_at
  before update on public.kasa_buckets
  for each row
  execute function public.set_updated_at();

-- Migration'dan kurulan ortamda (yerel docker, kurtarma) yetki gelmez; explicit grant
-- (db:audit:grants:local + CI zorlar — policy'si olup grant'i olmayan tablo ölü koddur).
grant select, insert, update, delete on table public.kasa_buckets to authenticated;
