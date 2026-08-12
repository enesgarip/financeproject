-- Kismi/asgari EKSTRE odemesi (denetim 2026-08-12 K7 tam kapsam; banka-model
-- denetiminin bilinçli açık maddesi).
--
-- Tasarim: arsiv tutari degismez (guard_card_statement_archive_mutation) ve
-- append-only felsefe korunur. Odemeler yeni cocuk tabloya yazilir:
--   kalan(arsiv) = arsiv.statement_debt_amount - sum(odemeler)
-- Kartin ekstre kovasi acik arsivlerin KALANLARININ toplamina projekte edilir.
-- Tam odeme (p_amount null ya da kalana esit) arsivi 'paid' yapar; kismi odeme
-- arsivi acik birakir. K4 cift-odeme guard'i (kova<=0 -> red) aynen korunur.

-- ── Tablo ────────────────────────────────────────────────────────────────────

create table public.card_statement_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  statement_archive_id uuid not null references public.card_statement_archives(id) on delete cascade,
  source_card_id uuid references public.cards(id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  -- false = bakiye banka/SMS tarafindan zaten dusulmustu (B4 yolu).
  source_debited boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create index card_statement_payments_user_idx on public.card_statement_payments (user_id);
create index card_statement_payments_archive_idx on public.card_statement_payments (statement_archive_id);

alter table public.card_statement_payments enable row level security;

create policy "card_statement_payments_select_own" on public.card_statement_payments
for select to authenticated
using (user_id = (select auth.uid()));

-- Insert yalniz backup restore icin acik (normal akis RPC/security definer).
-- card_expenses desenindeki sahiplik kontrolleriyle: kart ve arsiv de kullanicinin olmali.
create policy "card_statement_payments_insert_own" on public.card_statement_payments
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.cards
    where cards.id = card_statement_payments.card_id
      and cards.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.card_statement_archives archive
    where archive.id = card_statement_payments.statement_archive_id
      and archive.user_id = (select auth.uid())
      and archive.card_id = card_statement_payments.card_id
  )
);

grant select, insert on table public.card_statement_payments to authenticated;
-- update/delete YOK: append-only. Silme yalniz FK cascade (arsiv/kart silinirse)
-- ve security definer reset yollariyla olur.

-- ── Append-only guard ────────────────────────────────────────────────────────

create or replace function private.guard_card_statement_payment_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  -- Kanonik sifirlama akislari gecebilir: tam reset VE kart import reset'i
  -- (arsiv silinirse FK cascade bu tabloya da iner; guard onlari bloklamamali).
  if v_user_id is not null and (
    coalesce(current_setting('app.finance_data_reset_user_id', true), '') = v_user_id::text
    or coalesce(current_setting('app.card_import_reset_user_id', true), '') = v_user_id::text
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception 'Ekstre ödemesi kaydı append-only: değiştirilemez veya silinemez.';
end;
$$;

revoke all on function private.guard_card_statement_payment_mutation() from public;
revoke all on function private.guard_card_statement_payment_mutation() from anon;
revoke all on function private.guard_card_statement_payment_mutation() from authenticated;

create trigger guard_card_statement_payment_mutation
before update or delete on public.card_statement_payments
for each row execute function private.guard_card_statement_payment_mutation();

-- ── Kalan-hesabi yardimcisi (RPC'ler ve projeksiyon icin tek kaynak) ─────────

create or replace function private.statement_remaining_amount(p_archive_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(
    greatest(
      0,
      coalesce((select statement_debt_amount from public.card_statement_archives where id = p_archive_id), 0)
        - coalesce((select sum(amount) from public.card_statement_payments where statement_archive_id = p_archive_id), 0)
    ),
    2
  );
$$;

revoke all on function private.statement_remaining_amount(uuid) from public;
revoke all on function private.statement_remaining_amount(uuid) from anon;
revoke all on function private.statement_remaining_amount(uuid) from authenticated;

-- ── pay_card_statement: opsiyonel p_amount ile kismi odeme ──────────────────
-- Eski 3-arg imza kaldirilir (PostgREST overload belirsizligi olmasin);
-- p_amount default null oldugundan mevcut cagrilar aynen calisir.

drop function if exists public.pay_card_statement(uuid, uuid, boolean);

create or replace function public.pay_card_statement(
  p_statement_id uuid,
  p_source_card_id uuid,
  p_skip_source_debit boolean default false,
  p_amount numeric default null
)
returns public.card_statement_archives
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_initial_card_id uuid;
  v_statement public.card_statement_archives%rowtype;
  v_result_statement public.card_statement_archives%rowtype;
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_remaining numeric(14, 2);
  v_payment_amount numeric(14, 2);
  v_is_full boolean;
  v_remaining_statement_debt numeric(14, 2);
  v_minimum_visible_debt numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select card_id
  into v_initial_card_id
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Ekstre bulunamadı.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_initial_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstresi ödenecek kredi kartı bulunamadı.';
  end if;

  select *
  into v_statement
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id
    and card_id = v_card.id
  for update;

  if not found then
    raise exception 'Ekstre bulunamadı veya kartı değişti; yeniden deneyin.';
  end if;

  if v_statement.status <> 'open' then
    raise exception 'Bu ekstre zaten kapalı.';
  end if;

  v_remaining := private.statement_remaining_amount(v_statement.id);
  if v_remaining <= 0 then
    raise exception 'Ekstrenin kalan borcu yok; ödeme yapılamaz.';
  end if;

  v_payment_amount := round(coalesce(p_amount, v_remaining), 2);

  if v_payment_amount <= 0 then
    raise exception 'Ödeme tutarı 0''dan büyük olmalı.';
  end if;

  if v_payment_amount > v_remaining then
    raise exception 'Ödeme tutarı ekstrenin kalan borcundan (% TL) büyük olamaz.', v_remaining;
  end if;

  -- K4 guard: kartin ekstre kovasi zaten sifirsa bu arsivin borcu baska bir
  -- akisla odenmis demektir; bankadan ikinci kez para dusurme.
  if round(greatest(0, v_card.statement_debt_amount), 2) <= 0 then
    raise exception 'Bu ekstrenin borcu görünmüyor: kart borcu daha önce başka bir ödemeyle kapatılmış olabilir. Tekrar ödeme bankadan ikinci kez para düşürürdü. Ekstre kaydını Kartlar sayfasındaki mutabakat akışıyla kapat.';
  end if;

  v_is_full := v_payment_amount = v_remaining;

  if p_skip_source_debit then
    -- B4: bakiye banka/SMS tarafindan zaten dusulmus; yalniz dogrula, dusme.
    select *
    into v_source
    from public.cards
    where id = p_source_card_id
      and user_id = v_user_id
      and card_type = 'banka_karti'
    for update;

    if not found then
      raise exception 'Kaynak banka hesabı bulunamadı.';
    end if;
  else
    v_source := private.debit_bank_account(p_source_card_id, v_payment_amount);
  end if;

  insert into public.card_statement_payments (
    user_id, card_id, statement_archive_id, source_card_id, amount, source_debited, note
  )
  values (
    v_user_id,
    v_card.id,
    v_statement.id,
    v_source.id,
    v_payment_amount,
    not p_skip_source_debit,
    case when v_is_full then null else 'Kısmi ekstre ödemesi.' end
  );

  if v_is_full then
    perform set_config('app.card_statement_payment_user_id', v_user_id::text, true);
    perform set_config('app.card_statement_payment_id', v_statement.id::text, true);

    update public.card_statement_archives
    set status = 'paid',
        paid_at = now(),
        payment_source_card_id = v_source.id,
        updated_at = now()
    where id = v_statement.id
    returning * into v_result_statement;

    perform set_config('app.card_statement_payment_id', '', true);
    perform set_config('app.card_statement_payment_user_id', '', true);
  else
    -- Kismi odeme: arsiv acik kalir, tutari degismez (kalan cocuk tablodan turer).
    select * into v_result_statement
    from public.card_statement_archives
    where id = v_statement.id;
  end if;

  -- Ekstre kovasi = acik arsivlerin KALANLARININ toplami (odemeler dusulmus).
  select round(coalesce(sum(private.statement_remaining_amount(archive.id)), 0), 2)
  into v_remaining_statement_debt
  from public.card_statement_archives archive
  where archive.user_id = v_user_id
    and archive.card_id = v_card.id
    and archive.status = 'open';

  v_minimum_visible_debt := round(
    v_remaining_statement_debt
      + greatest(0, v_card.current_period_spending)
      + greatest(0, v_card.provision_amount),
    2
  );

  update public.cards
  set debt_amount = greatest(
        0,
        round(v_card.debt_amount - v_payment_amount, 2),
        v_minimum_visible_debt
      ),
      statement_debt_amount = v_remaining_statement_debt,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (
    user_id, type, title, amount, source_table, source_id, note
  )
  values (
    v_user_id,
    'payment',
    v_card.card_name || case when v_is_full then ' ekstresi ödendi' else ' ekstresi kısmen ödendi' end,
    v_payment_amount,
    'card_statement_archives',
    v_statement.id,
    v_source.card_name || case
      when p_skip_source_debit
      then ' hesabındaki bakiye banka/SMS hareketiyle zaten düşülmüştü; tekrar düşülmedi.'
      else ' hesabından ödendi.'
    end || case
      when v_is_full then ' Taksit planı değiştirilmedi.'
      else ' Kalan ekstre borcu: ' || private.statement_remaining_amount(v_statement.id)::text || ' TL.'
    end
  );

  return v_result_statement;
end;
$$;

revoke execute on function public.pay_card_statement(uuid, uuid, boolean, numeric) from public;
revoke execute on function public.pay_card_statement(uuid, uuid, boolean, numeric) from anon;
grant execute on function public.pay_card_statement(uuid, uuid, boolean, numeric) to authenticated;

-- ── Reset kapsami ────────────────────────────────────────────────────────────
-- Taban: 20260804150000'deki SON tanim (K3 dersinden: asla eski govdeden
-- kopyalama — cars/contexts/acks silmeleri orada eklendi). Tek fark: odeme
-- kayitlari arsivden ONCE, GUC'lu blok icinde silinir.

create or replace function public.reset_user_finance_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Oturum bulunamadı.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 1647595321)
  );

  perform id from public.cards where user_id = v_user_id order by id for update;

  delete from public.data_health_issue_acknowledgements where user_id = v_user_id;
  delete from public.data_health_repair_runs where user_id = v_user_id;
  delete from public.notification_preferences where user_id = v_user_id;
  delete from public.push_subscriptions where user_id = v_user_id;
  delete from public.wishlist_items where user_id = v_user_id;
  delete from public.kasa_buckets where user_id = v_user_id;
  delete from public.dismissed_upcoming_items where user_id = v_user_id;
  delete from public.context_expenses where user_id = v_user_id;
  delete from public.expense_contexts where user_id = v_user_id;
  delete from public.car_reminders where user_id = v_user_id;
  delete from public.car_expenses where user_id = v_user_id;

  perform set_config('app.finance_data_reset_user_id', v_user_id::text, true);
  delete from public.notification_log where user_id = v_user_id;
  delete from public.sms_log where user_id = v_user_id;
  delete from public.account_reconciliations where user_id = v_user_id;
  delete from public.card_installments where user_id = v_user_id;
  delete from public.card_expenses where user_id = v_user_id;
  delete from public.card_statement_payments where user_id = v_user_id;
  delete from public.card_statement_archives where user_id = v_user_id;
  delete from public.card_current_settlements where user_id = v_user_id;
  perform set_config('app.finance_data_reset_user_id', '', true);

  delete from public.cars where user_id = v_user_id;
  delete from public.card_aliases where user_id = v_user_id;
  delete from public.loan_installments where user_id = v_user_id;
  delete from public.savings_goal_components where user_id = v_user_id;
  delete from public.transaction_history where user_id = v_user_id;
  delete from public.payments where user_id = v_user_id;
  delete from public.budgets where user_id = v_user_id;
  delete from public.net_worth_snapshots where user_id = v_user_id;
  delete from public.gold_lots where user_id = v_user_id;
  delete from public.savings_goals where user_id = v_user_id;
  delete from public.salary_history where user_id = v_user_id;
  delete from public.debts where user_id = v_user_id;
  delete from public.loans where user_id = v_user_id;
  delete from public.cards where user_id = v_user_id;
  delete from public.assets where user_id = v_user_id;
end;
$$;

revoke all on function public.reset_user_finance_data() from public;
revoke all on function public.reset_user_finance_data() from anon;
grant execute on function public.reset_user_finance_data() to authenticated;
