-- Web Push v1.1: tür bazlı bildirim tercihleri + sessiz saatler.
-- Kullanıcı başına tek satır (upsert). Edge fonksiyonu (push-notify) gönderim
-- öncesi bu satırı okuyup kapalı türleri ve sessiz saat penceresini atlar.
-- Sessiz saat NULL/NULL ise pencere yok. Saatler Europe/Istanbul yerel saatidir.
create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payments_enabled boolean not null default true,
  loans_enabled boolean not null default true,
  statements_enabled boolean not null default true,
  weekly_enabled boolean not null default true,
  quiet_hours_start smallint null check (quiet_hours_start is null or (quiet_hours_start between 0 and 23)),
  quiet_hours_end smallint null check (quiet_hours_end is null or (quiet_hours_end between 0 and 23))
);

alter table public.notification_preferences enable row level security;

create policy "own rows" on public.notification_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_updated_at
  before update on public.notification_preferences
  for each row
  execute function public.set_updated_at();

-- Edge fonksiyonu service_role ile okur; kullanıcı kendi tercihini yönetir.
grant select, insert, update, delete on table public.notification_preferences to authenticated;
