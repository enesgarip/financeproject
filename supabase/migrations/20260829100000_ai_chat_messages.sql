-- AI asistan sohbet geçmişi (/analiz/asistan): kullanıcı, finansal özetiyle
-- birlikte Gemini'ye soru sorar; soru + yanıt burada kalıcı tutulur.
-- Tek sürekli akış (thread/conversation kavramı YOK); "geçmişi temizle" = delete.
-- Edge function (ai-chat) DB'ye DOKUNMAZ — okuma/yazma yalnız istemciden,
-- RLS altında (data/repositories/aiChatRepo.ts).
-- Backup/reset kapsamı DIŞI (client_errors emsali): finansal veri değil sohbet
-- kaydı — utils/backup.ts listelerine ve restore RPC'sine bilinçli EKLENMEDİ.

create table public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  -- default auth.uid(): istemci kolonu hiç göndermez, RLS with check yine korur.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role in ('user', 'assistant')),
  -- Üst sınır edge yanıt kırpmasıyla uyumlu (reply ≤ 16_000 < 16384).
  content text not null check (char_length(content) between 1 and 16384)
);

create index ai_chat_messages_user_created_idx
  on public.ai_chat_messages (user_id, created_at desc);

alter table public.ai_chat_messages enable row level security;

-- initPlan dostu (select auth.uid()) deseni; komut bazlı policy'ler grant
-- setiyle BİREBİR (select/insert/delete) — client_errors'taki gerekçeyle aynı.
create policy "own rows select" on public.ai_chat_messages
  for select using ((select auth.uid()) = user_id);
create policy "own rows insert" on public.ai_chat_messages
  for insert with check ((select auth.uid()) = user_id);
create policy "own rows delete" on public.ai_chat_messages
  for delete using ((select auth.uid()) = user_id);

-- Migration'dan kurulan ortamda (yerel docker, kurtarma) yetki gelmez.
-- UPDATE bilinçli yok: mesaj düzenlenmez, yazılır/okunur/temizlenir.
grant select, insert, delete on table public.ai_chat_messages to authenticated;
