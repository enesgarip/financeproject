-- Alışveriş / istek listesi
create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  estimated_price numeric null,
  is_purchased boolean not null default false,
  purchased_at timestamptz null,
  sort_order int not null default 0,
  note text null
);

alter table public.wishlist_items enable row level security;

create policy "own rows" on public.wishlist_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_updated_at
  before update on public.wishlist_items
  for each row
  execute function public.set_updated_at();
