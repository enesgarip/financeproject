-- Kart takma adları: birden fazla fiziksel/sanal kart numarasını tek ana karta eşler.
-- SMS parse otomasyonunda son 4 hane ile kartı bulmak için kullanılır.

create table if not exists public.card_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  card_id uuid not null references public.cards(id) on delete cascade,
  last_four_digits text not null check (last_four_digits ~ '^\d{4}$'),
  label text  -- 'fiziksel', 'sanal', 'ek kart' vb. opsiyonel açıklama
);

-- Aynı kullanıcıda aynı 4 hane tekrar edemez
create unique index card_aliases_user_digits_uniq
  on public.card_aliases (user_id, last_four_digits);

-- RLS
alter table public.card_aliases enable row level security;

create policy "card_aliases_select_own" on public.card_aliases
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "card_aliases_insert_own" on public.card_aliases
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "card_aliases_update_own" on public.card_aliases
  for update to authenticated
  using (user_id = (select auth.uid()));

create policy "card_aliases_delete_own" on public.card_aliases
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- cards.last_four_digits artık gereksiz
alter table public.cards drop column if exists last_four_digits;
