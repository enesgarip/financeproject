-- Bank account balance ledger — event-sourced cash (roadmap "güven" Faz 3).
--
-- A2 gave credit-card debt an append-only, exact (integer-kuruş), auditable
-- event log (`card_ledger`). A bank account's `current_balance` is still a bare
-- mutable float with no trail of HOW it changed. This table does for cash what
-- card_ledger did for debt: every balance change becomes an append-only,
-- immutable event captured ATOMICALLY via an AFTER trigger on `cards`.
--
-- `current_balance` is moved by ~9 RPCs (payments, transfers, expense source
-- deductions) AND by a direct client write (services/accountMovements.ts manual
-- in/out). A trigger on `cards` captures all of them without rewiring any call
-- site — exactly the card_ledger rationale.
--
-- Amounts are signed INTEGER KURUŞ (bigint): +deposit (balance up),
-- -withdrawal (balance down). sum(amount_kurus) = round(current_balance*100) by
-- construction. Append-only: only select + insert granted; rows never updated/
-- deleted by the app; on card delete they cascade away.

create table if not exists public.account_ledger (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  card_id      uuid        not null references public.cards(id) on delete cascade,
  occurred_at  timestamptz not null default now(),
  kind         text        not null check (kind in ('opening', 'deposit', 'withdrawal')),
  amount_kurus bigint      not null,
  note         text,
  source_table text,
  source_id    uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.account_ledger enable row level security;

-- Append-only from the client: select + insert only. Supabase grants ALL to
-- `authenticated` by default, so explicitly revoke mutation/truncate to enforce
-- immutability at the privilege layer (RLS is the second line of defence).
grant select, insert on table public.account_ledger to authenticated;
revoke update, delete, truncate on table public.account_ledger from authenticated;

drop policy if exists "account_ledger_select_own" on public.account_ledger;
create policy "account_ledger_select_own"
  on public.account_ledger for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "account_ledger_insert_own" on public.account_ledger;
create policy "account_ledger_insert_own"
  on public.account_ledger for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create index if not exists account_ledger_card_idx
  on public.account_ledger (user_id, card_id, occurred_at);

-- Audit trigger: records every bank-account current_balance change as a ledger
-- event. SECURITY DEFINER so it can always insert (also when a migration or RPC
-- moves balance with no auth.uid() in context); it writes user_id = NEW.user_id
-- itself, so it never crosses tenant boundaries. Independent of the A2 debt
-- trigger (different card_type + field) — both fire on cards AFTER, no conflict.
create or replace function public.record_account_balance_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(14, 2);
begin
  if (tg_op = 'INSERT') then
    if new.card_type = 'banka_karti' and coalesce(new.current_balance, 0) <> 0 then
      insert into public.account_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id)
      values (new.user_id, new.id, 'opening', round(new.current_balance * 100)::bigint,
              'Hesap açılış bakiyesi', 'cards', new.id);
    end if;
    return new;
  end if;

  -- UPDATE
  if new.card_type = 'banka_karti' then
    v_delta := coalesce(new.current_balance, 0) - coalesce(old.current_balance, 0);
    if v_delta <> 0 then
      insert into public.account_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id)
      values (new.user_id, new.id,
              case when v_delta > 0 then 'deposit' else 'withdrawal' end,
              round(v_delta * 100)::bigint,
              'Bakiye değişimi (otomatik kayıt)', 'cards', new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists cards_balance_ledger on public.cards;
create trigger cards_balance_ledger
  after insert or update on public.cards
  for each row execute function public.record_account_balance_event();

-- Backfill: one opening event per existing bank account so the projected balance
-- (sum of events) equals today's stored balance from day one. Idempotent.
insert into public.account_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id, occurred_at)
select c.user_id, c.id, 'opening', round(c.current_balance * 100)::bigint,
       'Mevcut bakiye (ledger başlangıç)', 'cards', c.id, now()
from public.cards c
where c.card_type = 'banka_karti'
  and coalesce(c.current_balance, 0) <> 0
  and not exists (select 1 from public.account_ledger al where al.card_id = c.id);
