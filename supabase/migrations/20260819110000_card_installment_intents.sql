-- Bekleyen taksit niyeti: alisveristen ONCE birakilan "bu islem N taksit olacak"
-- notu, SMS provizyonu dustugu anda otomatik uygulanir.
--
-- Kok sorun: banka SMS'i taksit bilgisi tasimaz; provizyon her zaman tek cekim
-- (installment_count = 1) dogar. Kullanici panelden taksit sayisini isaretlemeyi
-- unutursa run_scheduled_card_maintenance 7. gunde provizyonu OLDUGU GIBI
-- kesinlestirir; ekstre kesildikten sonra duzeltme append-only correction
-- akisina duser. Niyet kaydi, taksit bilgisini karar aninda (magazada) yakalayip
-- 7 gunluk pencereye bagimliligi kaldirir.
--
-- Para modeline etkisi YOKTUR: niyet yalnizca provizyonun installment_count
-- etiketini yazar (setProvisionInstallments ile ayni alan). Borc, kova ve ledger
-- olaylari degismez; taksit dagilimi yine post_card_provision'da hesaplanir.

create table public.card_installment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- NULL = kullanicinin herhangi bir kredi karti (hangi kartla odeyecegini
  -- bilmiyor olabilir); doluysa yalniz o kartin provizyonuna uygulanir.
  card_id uuid null references public.cards(id) on delete cascade,
  -- Satici ipucu: normalize edilmis aciklamada gecmesi beklenen metin.
  merchant_hint text null,
  min_amount numeric(14, 2) null check (min_amount is null or min_amount > 0),
  max_amount numeric(14, 2) null check (max_amount is null or max_amount > 0),
  installment_count smallint not null check (installment_count between 2 and 36),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'consumed', 'cancelled')),
  consumed_expense_id uuid null references public.card_expenses(id) on delete set null,
  consumed_at timestamptz null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_installment_intents_amount_window check (
    min_amount is null or max_amount is null or max_amount >= min_amount
  )
);

create index card_installment_intents_active_idx
  on public.card_installment_intents (user_id, status, expires_at);

alter table public.card_installment_intents enable row level security;

create policy "own rows" on public.card_installment_intents
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger set_updated_at
  before update on public.card_installment_intents
  for each row
  execute function public.set_updated_at();

-- Migration'dan kurulan ortamlarda (yerel docker, kurtarma) yetki otomatik gelmez.
grant select, insert, update, delete on table public.card_installment_intents to authenticated;

-- src/utils/searchText.ts ikizi: tr-TR'de buyuk "I" noktasiz "i"ya katlandigi
-- icin once [Iİ] → i map'lenir, sonra kucultulur (CLAUDE.md tr-TR tuzagi).
create or replace function private.normalize_match_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.translate(pg_catalog.btrim(coalesce(p_value, '')), 'Iİ', 'ii')),
      '\s+', ' ', 'g'
    )
  );
$$;

revoke all on function private.normalize_match_text(text) from public, anon, authenticated;

/*
 * Bir provizyona uyan aktif niyeti tuketir.
 *
 * Yalniz `status='provision'` ve `installment_count=1` satira dokunur; yaptigi
 * tek sey installment_count/installment_amount etiketini yazmaktir (borc, kova,
 * ledger degismez). Birden cok niyet uyuyorsa EN OZELI secilir: kart bagli olan,
 * sonra satici ipucu olan, sonra dar tutar penceresi, sonra en eski. Eslesme
 * yoksa satir oldugu gibi doner.
 */
create or replace function private.apply_card_installment_intent(
  p_expense_id uuid,
  p_user_id uuid
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
declare
  v_expense public.card_expenses%rowtype;
  v_intent public.card_installment_intents%rowtype;
begin
  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = p_user_id
  for update;

  if not found then
    return null;
  end if;

  if v_expense.status <> 'provision' or v_expense.installment_count <> 1 then
    return v_expense;
  end if;

  select *
  into v_intent
  from public.card_installment_intents
  where user_id = p_user_id
    and status = 'active'
    and expires_at > now()
    and (card_id is null or card_id = v_expense.card_id)
    and (min_amount is null or v_expense.amount >= min_amount)
    and (max_amount is null or v_expense.amount <= max_amount)
    and (
      merchant_hint is null
      or private.normalize_match_text(v_expense.description)
         like '%' || private.normalize_match_text(merchant_hint) || '%'
    )
  order by
    (card_id is not null) desc,
    (merchant_hint is not null) desc,
    coalesce(max_amount, 1e12) - coalesce(min_amount, 0) asc,
    created_at asc
  limit 1
  for update;

  if not found then
    return v_expense;
  end if;

  update public.card_expenses
  set installment_count = v_intent.installment_count,
      installment_amount = round(v_expense.amount / v_intent.installment_count, 2),
      note = coalesce(nullif(btrim(coalesce(v_expense.note, '')), '') || ' ', '')
        || 'Taksit niyeti otomatik uygulandi (' || v_intent.installment_count || ' taksit).',
      updated_at = now()
  where id = v_expense.id
  returning * into v_expense;

  update public.card_installment_intents
  set status = 'consumed',
      consumed_expense_id = v_expense.id,
      consumed_at = now(),
      updated_at = now()
  where id = v_intent.id;

  return v_expense;
end;
$$;

revoke all on function private.apply_card_installment_intent(uuid, uuid) from public, anon, authenticated;

-- SMS provizyonu yaratildiktan hemen sonra niyeti uygula. Planli odemeyle
-- eslesen SMS'ler (bank_auto fatura) taksitli alisveris degildir; o dal
-- disarida birakilir.
create or replace function public.record_sms_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at timestamptz,
  p_category text,
  p_user_id uuid,
  p_source_event_id text
)
returns public.card_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := (select auth.role());
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_spent_at date := coalesce((p_spent_at at time zone 'Europe/Istanbul')::date, current_date);
  v_event_id text := nullif(btrim(coalesce(p_source_event_id, '')), '');
  v_description text := btrim(coalesce(p_description, ''));
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Diğer');
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_payment public.payments%rowtype;
  v_candidate_count integer := 0;
  v_candidate_id uuid;
  v_next_month_start date;
  v_next_month_end date;
  v_next_due_day integer;
  v_next_due_date date;
  v_intent_expense public.card_expenses%rowtype;
begin
  if v_role <> 'service_role' then
    raise exception 'Bu işlem yalnız SMS servisi tarafından çalıştırılabilir.';
  end if;

  if p_user_id is null then
    raise exception 'SMS sahibi zorunlu.';
  end if;

  if v_amount <= 0 then
    raise exception 'Harcama tutarı 0 dan büyük olmalı.';
  end if;

  if v_description = '' then
    raise exception 'Harcama açıklaması zorunlu.';
  end if;

  if v_event_id is null then
    raise exception 'SMS olay kimliği zorunlu.';
  end if;

  if length(v_event_id) > 200 then
    raise exception 'SMS olay kimliği çok uzun.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_user_id::text || '|sms|' || v_event_id,
    0
  ));

  select *
  into v_expense
  from public.card_expenses
  where user_id = p_user_id
    and source = 'sms'
    and source_event_id = v_event_id;

  if found then
    if v_expense.card_id <> p_card_id then
      raise exception 'SMS olay kimliği başka bir karta ait.';
    end if;
    return v_expense;
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = p_user_id
    and card_type = 'kredi_karti'
  for update;

  if not found then
    raise exception 'SMS için kredi kartı bulunamadı.';
  end if;

  -- Otomatik görev SMS'ten önce çalıştıysa aynı finansal hareket zaten vardır.
  -- Yalnız tek aday varsa kaynağı SMS olayına bağla; borca tekrar dokunma.
  select count(*), (array_agg(id order by created_at, id))[1]
  into v_candidate_count, v_candidate_id
  from public.card_expenses
  where user_id = p_user_id
    and card_id = p_card_id
    and status <> 'cancelled'
    and source_event_id is null
    and current_settlement_id is null
    and note like 'Odeme kaydindan olusturuldu.%'
    and abs(spent_at - v_spent_at) <= 3
    and abs(amount - v_amount) <= greatest(
      5::numeric,
      round(greatest(abs(amount), abs(v_amount)) * 0.01, 2)
    );

  if v_candidate_count = 1 then
    update public.card_expenses
    set source = 'sms',
        source_event_id = v_event_id,
        updated_at = now()
    where id = v_candidate_id
    returning * into v_expense;

    return v_expense;
  end if;

  -- SMS önce geldiyse, tek güvenli plan adayını kilitle ve aynı işlem olarak ilerlet.
  select count(*), (array_agg(id order by due_date, id))[1]
  into v_candidate_count, v_candidate_id
  from public.payments
  where user_id = p_user_id
    and status = 'bekliyor'
    and payment_method = 'bank_auto'
    and auto_source_card_id = p_card_id
    and abs(due_date - v_spent_at) <= 3
    and abs(amount - v_amount) <= greatest(
      5::numeric,
      round(greatest(abs(amount), abs(v_amount)) * 0.01, 2)
    );

  if v_candidate_count = 1 then
    select *
    into v_payment
    from public.payments
    where id = v_candidate_id
      and user_id = p_user_id
      and status = 'bekliyor'
    for update;
  end if;

  v_expense := public.add_card_expense(
    p_card_id => p_card_id,
    p_amount => v_amount,
    p_description => v_description,
    p_spent_at => v_spent_at,
    p_installment_count => 1,
    p_category => case when v_payment.id is null then v_category else coalesce(v_payment.category, v_category) end,
    p_status => 'provision',
    p_user_id => p_user_id,
    p_source => 'sms',
    p_source_event_id => v_event_id
  );

  if v_payment.id is null then
    -- Taksit niyeti yalnız gerçek alışveriş provizyonuna uygulanır.
    v_intent_expense := private.apply_card_installment_intent(v_expense.id, p_user_id);
    if v_intent_expense.id is not null then
      v_expense := v_intent_expense;
    end if;
    return v_expense;
  end if;

  update public.card_expenses
  set note = 'Odeme kaydiyla SMS uzerinden eslestirildi. Vade: '
      || to_char(v_payment.due_date, 'YYYY-MM-DD'),
      updated_at = now()
  where id = v_expense.id
  returning * into v_expense;

  if v_payment.recurrence = 'monthly' then
    v_next_month_start := (date_trunc('month', v_payment.due_date)::date + interval '1 month')::date;
    v_next_month_end := (date_trunc('month', v_next_month_start)::date + interval '1 month - 1 day')::date;
    v_next_due_day := least(
      coalesce(v_payment.recurrence_day, extract(day from v_payment.due_date)::integer),
      extract(day from v_next_month_end)::integer
    );
    v_next_due_date := v_next_month_start + (v_next_due_day - 1);

    if v_payment.recurrence_end_date is not null and v_next_due_date > v_payment.recurrence_end_date then
      update public.payments
      set amount = v_amount,
          amount_status = 'exact',
          status = 'ödendi',
          updated_at = now()
      where id = v_payment.id;
    else
      update public.payments
      set amount = v_amount,
          amount_status = 'estimated',
          due_date = v_next_due_date,
          status = 'bekliyor',
          updated_at = now()
      where id = v_payment.id;
    end if;
  else
    update public.payments
    set amount = v_amount,
        amount_status = 'exact',
        status = 'ödendi',
        updated_at = now()
    where id = v_payment.id;
  end if;

  insert into public.transaction_history (
    user_id, type, title, amount, source_table, source_id, note, occurred_at
  )
  values (
    p_user_id,
    'payment',
    v_payment.title || ' SMS ile eşlendi',
    v_amount,
    'payments',
    v_payment.id,
    v_card.card_name || ' kredi kartındaki banka SMS hareketiyle eşlendi. Vade: '
      || to_char(v_payment.due_date, 'YYYY-MM-DD'),
    p_spent_at
  );

  return v_expense;
end;
$$;

-- Kullanıcı kendi provizyonuna niyeti elle de uygulayabilsin (SMS dışı yollar,
-- örneğin uygulamadan eklenen provizyon veya niyet SMS'ten sonra yazıldıysa).
-- DEFINER: yalniz private helper'i cagirabilmek icin. Sahiplik auth.uid()'e
-- baglanir ve helper hem gideri hem niyeti user_id ile filtreler; baska
-- kullanicinin satirina erisim yolu yoktur.
create or replace function public.apply_card_installment_intent(p_expense_id uuid)
returns public.card_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  return private.apply_card_installment_intent(p_expense_id, v_user_id);
end;
$$;

revoke all on function public.apply_card_installment_intent(uuid) from public, anon;
grant execute on function public.apply_card_installment_intent(uuid) to authenticated;

-- Yeni tablo tam kullanici sifirlama kapsamina girer (backup/reset butunlugu).
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
  delete from public.card_installment_intents where user_id = v_user_id;
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
