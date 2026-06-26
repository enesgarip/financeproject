-- SMS otomasyonu işleme geçmişi (roadmap: başarı/hata görünürlüğü).
--
-- parse-sms edge function her çağrıda (başarılı da, başarısız da) tek satır
-- yazar. user_id, kullanıcı henüz çözülememişse (örn. kart/hesap eşleşmedi)
-- null olabilir — service_role bu durumda bile log atabilsin diye nullable.

create table if not exists public.sms_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  sms_type text not null check (sms_type in ('card_expense', 'account_movement', 'unrecognized')),
  status text not null check (status in ('success', 'error')),
  summary text,
  amount numeric(14, 2),
  error_message text,
  raw_sms text not null
);

create index if not exists sms_log_user_created_idx
  on public.sms_log (user_id, created_at desc);

alter table public.sms_log enable row level security;

grant select on table public.sms_log to authenticated;
grant select, insert, delete on table public.sms_log to service_role;

drop policy if exists "sms_log_select_own" on public.sms_log;
create policy "sms_log_select_own"
  on public.sms_log for select
  to authenticated
  using (user_id = (select auth.uid()) or user_id is null);
