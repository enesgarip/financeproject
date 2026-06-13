-- Web Push abonelikleri (roadmap Y1 — proaktif bildirim katmanı).
--
-- Tarayıcının PushManager.subscribe() çıktısını saklar: endpoint + iki anahtar
-- (p256dh, auth). Zamanlanmış gönderici edge fonksiyonu (push-notify) bu
-- satırları service-role ile okuyup VAPID ile şifreli push gönderir.
--
-- Kullanıcı kendi aboneliklerini yönetir (cihaz başına bir satır) → tam CRUD
-- grant (ledger'lardan farklı; bu append-only değil, kullanıcı bir cihazı
-- kapatınca satır silinir/güncellenir). (user_id, endpoint) benzersiz: aynı
-- cihaz yeniden abone olursa upsert eder, çoğaltmaz.

create table if not exists public.push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  endpoint    text        not null,
  p256dh      text        not null,
  auth        text        not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();
