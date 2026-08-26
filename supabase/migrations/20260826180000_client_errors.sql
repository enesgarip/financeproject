-- İstemci hata kayıtları (mühendislik turu ②): Sentry bilinçli kaldırıldı
-- (2026-08-19 — DSN üretimde hiç tanımlı değildi, rapor zaten gitmiyordu) ve
-- telefon PWA'sında konsola erişim yok; üretim çökmeleri tamamen görünmezdi.
-- Yazan: src/lib/errorReport.ts (AppErrorBoundary + window error/
-- unhandledrejection; mesaj-hash GÜNLÜK dedupe + oturum başına ~5 kayıt tavanı
-- — çökme döngüsü tabloyu şişiremez). Yüzey: DataHealth > İşlemler.
-- commit_sha hatayı deploy'a eşler (__APP_COMMIT__ = build'deki GITHUB_SHA).
-- Retention istemciden en-iyi-çaba: oturumda bir kez 90 günden eski kendi
-- satırlarını siler (delete grant'ı bunun için).

create table public.client_errors (
  id uuid primary key default gen_random_uuid(),
  -- default auth.uid(): istemci kolonu hiç göndermez, RLS with check yine korur.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  source text not null check (source in ('boundary', 'error', 'unhandledrejection')),
  message text not null,
  stack text,
  route text,
  commit_sha text,
  user_agent text,
  -- Aynı hatanın günlük tekilleştirme anahtarı (istemci üretir: hash(source+mesaj)).
  fingerprint text not null
);

create index client_errors_user_created_idx
  on public.client_errors (user_id, created_at desc);

alter table public.client_errors enable row level security;

-- initPlan dostu (select auth.uid()) deseni (20260503 düzeltmesiyle aynı).
-- Komut bazlı policy'ler grant setiyle BİREBİR (select/insert/delete): tek
-- "for all" policy UPDATE'i de kapsayıp grant'sız ölü policy bırakıyordu —
-- grants denetimi yakaladı.
create policy "own rows select" on public.client_errors
  for select using ((select auth.uid()) = user_id);
create policy "own rows insert" on public.client_errors
  for insert with check ((select auth.uid()) = user_id);
create policy "own rows delete" on public.client_errors
  for delete using ((select auth.uid()) = user_id);

-- Migration'dan kurulan ortamda (yerel docker, kurtarma) yetki gelmez.
-- UPDATE bilinçli yok: hata kaydı düzenlenmez, yazılır/okunur/temizlenir.
grant select, insert, delete on table public.client_errors to authenticated;
