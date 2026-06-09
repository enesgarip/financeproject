-- Card debt ledger — pilot of the event-sourced money model (roadmap A2).
--
-- Today a credit card's debt lives in mutable `cards.debt_amount` (numeric(14,2)),
-- and `transaction_history` is only an after-the-fact log written by the client
-- (non-atomic, can drift). This table makes every debt change an append-only,
-- immutable event captured ATOMICALLY with the change itself, via an AFTER
-- trigger on `cards`. So no matter which of the ~15 RPCs or client writes moves
-- the debt, the ledger stays complete without rewiring each one.
--
-- Amounts are stored as signed INTEGER KURUŞ (bigint): +debit (debt up),
-- -credit (debt down). This puts the kuruş money model (src/utils/money.ts)
-- into the schema. The projection sum(amount_kurus) equals round(debt*100) by
-- construction, so the stored balance can later become a pure projection; for
-- now the ledger delivers an auditable trail ("bu borç neyden oluşuyor") and a
-- reconciliation primitive, with zero change to data-entry behaviour.
--
-- Append-only: only select + insert are granted to authenticated. Rows are
-- never updated/deleted by the app; on card delete they cascade away.

create table if not exists public.card_ledger (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  card_id      uuid        not null references public.cards(id) on delete cascade,
  occurred_at  timestamptz not null default now(),
  kind         text        not null check (kind in ('opening', 'debit', 'credit')),
  amount_kurus bigint      not null,
  note         text,
  source_table text,
  source_id    uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.card_ledger enable row level security;

-- Append-only from the client: select + insert only. Supabase grants ALL on
-- public tables to `authenticated` by default, so we must explicitly revoke
-- mutation/truncate to enforce immutability at the privilege layer (RLS, which
-- has no update/delete policy, is the second line of defence).
grant select, insert on table public.card_ledger to authenticated;
revoke update, delete, truncate on table public.card_ledger from authenticated;

drop policy if exists "card_ledger_select_own" on public.card_ledger;
create policy "card_ledger_select_own"
  on public.card_ledger for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "card_ledger_insert_own" on public.card_ledger;
create policy "card_ledger_insert_own"
  on public.card_ledger for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create index if not exists card_ledger_card_idx
  on public.card_ledger (user_id, card_id, occurred_at);

-- Audit trigger: records every credit-card debt_amount change as a ledger event.
-- SECURITY DEFINER so it can always insert (also when a migration or RPC moves
-- debt with no auth.uid() in context); it writes user_id = NEW.user_id itself,
-- so it never crosses tenant boundaries.
create or replace function public.record_card_debt_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(14, 2);
begin
  if (tg_op = 'INSERT') then
    if new.card_type = 'kredi_karti' and coalesce(new.debt_amount, 0) <> 0 then
      insert into public.card_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id)
      values (new.user_id, new.id, 'opening', round(new.debt_amount * 100)::bigint,
              'Kart açılış borcu', 'cards', new.id);
    end if;
    return new;
  end if;

  -- UPDATE
  if new.card_type = 'kredi_karti' then
    v_delta := coalesce(new.debt_amount, 0) - coalesce(old.debt_amount, 0);
    if v_delta <> 0 then
      insert into public.card_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id)
      values (new.user_id, new.id,
              case when v_delta > 0 then 'debit' else 'credit' end,
              round(v_delta * 100)::bigint,
              'Borç değişimi (otomatik kayıt)', 'cards', new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists cards_debt_ledger on public.cards;
create trigger cards_debt_ledger
  after insert or update on public.cards
  for each row execute function public.record_card_debt_event();

-- Backfill: one opening event per existing credit card so the projected balance
-- (sum of events) equals today's stored debt from day one. Idempotent: skips
-- cards that already have ledger rows.
insert into public.card_ledger (user_id, card_id, kind, amount_kurus, note, source_table, source_id, occurred_at)
select c.user_id, c.id, 'opening', round(c.debt_amount * 100)::bigint,
       'Mevcut borç (ledger başlangıç)', 'cards', c.id, now()
from public.cards c
where c.card_type = 'kredi_karti'
  and coalesce(c.debt_amount, 0) <> 0
  and not exists (select 1 from public.card_ledger cl where cl.card_id = c.id);
