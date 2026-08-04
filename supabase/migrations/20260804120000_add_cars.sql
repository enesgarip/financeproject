-- Arabalarım: araç başına gider takibi. İki kaynak birleşir ama çift saymaz:
--   1) Kartla yapılan giderler zaten card_expenses'te (borcu o taşır). Buraya
--      yalnız bir ETIKET (card_expenses.car_id) düşülür — para matematiği değişmez.
--   2) Kart-dışı (nakit/banka: MTV, sigorta, nakit yakıt) giderler car_expenses'e
--      ayrı satır olarak girilir. Bunlar da net değer/nakit akışı/yükümlülük
--      matematiğine GİRMEZ — saf bir raporlama merceğidir.
-- Bir gerçek harcama doğası gereği ya kartta ya kart-dışıdır; ikisi ayrık olduğu
-- için toplarken mükerrer sayım oluşmaz.

create table public.cars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  plate text null,
  sort_order int not null default 0,
  note text null
);

create index cars_user_idx on public.cars (user_id);

alter table public.cars enable row level security;

create policy "own rows" on public.cars
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_updated_at
  before update on public.cars
  for each row
  execute function public.set_updated_at();

grant select, insert, update, delete on table public.cars to authenticated;

-- Kart-dışı manuel araç giderleri (nakit/banka). Kart giderleri buraya GİRMEZ;
-- onlar card_expenses + car_id etiketiyle takip edilir (tek kaynak, mükerrer yok).
create table public.car_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  car_id uuid not null references public.cars(id) on delete cascade,
  spent_at date not null default current_date,
  amount numeric not null check (amount > 0),
  category text not null default 'Diğer',
  payment_method text not null default 'nakit'
    check (payment_method in ('nakit', 'banka', 'diger')),
  description text not null default '',
  note text null
);

create index car_expenses_user_idx on public.car_expenses (user_id);
create index car_expenses_car_idx on public.car_expenses (car_id);

alter table public.car_expenses enable row level security;

create policy "own rows" on public.car_expenses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_updated_at
  before update on public.car_expenses
  for each row
  execute function public.set_updated_at();

grant select, insert, update, delete on table public.car_expenses to authenticated;

-- Kart harcamasını bir araca ETİKETLE. Saf annotation: borç/ekstre/ledger
-- matematiğine dokunmaz (add_card_expense RPC'si değişmez; etiket harcama
-- oluştuktan sonra ayrı UPDATE ile atanır, tıpkı kategori güncellemesi gibi).
-- Araç silinince etiket düşer (harcama ve borç aynen kalır).
alter table public.card_expenses
  add column if not exists car_id uuid null references public.cars(id) on delete set null;

create index if not exists card_expenses_car_idx
  on public.card_expenses (car_id)
  where car_id is not null;
