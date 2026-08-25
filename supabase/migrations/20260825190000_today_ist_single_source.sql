-- "Bugün"ün tek kaynağı: 12 fonksiyonda current_date → private.today_ist().
--
-- Neden: istanbul_calendar (20260819120000) DB saat dilimini Istanbul yaptı ve
-- current_date doğru güne oturdu; ama gün ifadesi 12 fonksiyona dağınık kaldı
-- ve TEST EDİLEMEZDİ — Şubat + kesim=31 gibi kenarlar için "bugünü" enjekte
-- etmenin yolu yoktu (BACKLOG K5'in park gerekçesi). Bu migration:
--
--  1) private.today_ist() artık `app.today` GUC'unu tanır: test
--     `set local app.today = '2027-02-15'` derse o günü, yoksa Istanbul
--     gününü döner. Üretim davranışı değişmez (GUC hiç set edilmez).
--  2) authenticated'a execute verilir — add_card_expense'in İMZA DEFAULT'u
--     (p_spent_at date default ...) SECURITY DEFINER gövdesinde değil
--     ÇAĞIRANIN yetkisiyle değerlenir; grant olmadan default today_ist'e
--     taşınamazdı (envanter tuzağı). Fonksiyon salt tarih döner, sızıntı yok.
--  3) 12 fonksiyonun CANLI tanımı (yerel docker'da pg_get_functiondef ile
--     dökülüp mekanik s/current_date/private.today_ist()/ uygulanmış hali —
--     el kopyası yok, davranış birebir): add_card_expense,
--     contribute_to_goal_bucket, cut_card_statement, cut_due_card_statements,
--     pay_card_debt, pay_payment, post_card_provision,
--     post_due_card_installments, record_sms_card_expense,
--     replace_card_statement_import, run_scheduled_card_maintenance,
--     update_card_expense.
--
-- Kenar testleri artık mümkün: supabase/tests/clock_injection_statement_cut.sql
-- (Şubat + kesim=31 kırpması + GUC yokken bugünle özdeşlik).

create or replace function private.today_ist()
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.current_setting('app.today', true), '')::date,
    (pg_catalog.now() at time zone 'Europe/Istanbul')::date
  );
$$;

-- İmza default'ları çağıran yetkisiyle değerlenir (bkz. üst not 2).
-- Şema USAGE'ı da şart: execute grant'i tek başına yetmez, çağıran şemaya
-- giremezse "permission denied for schema private" alır. USAGE yalnız
-- görünürlük verir — şemadaki DİĞER fonksiyonlar execute-grant'sız çağrılamaz
-- kalır (today_ist dışında hiçbirine grant verilmedi; debit/credit yardımcıları
-- yalnız SECURITY DEFINER gövdelerinden koşmaya devam eder).
grant usage on schema private to authenticated;
grant execute on function private.today_ist() to authenticated;

CREATE OR REPLACE FUNCTION public.add_card_expense(p_card_id uuid, p_amount numeric, p_description text, p_spent_at date DEFAULT CURRENT_DATE, p_installment_count integer DEFAULT 1, p_category text DEFAULT 'Diğer'::text, p_status text DEFAULT 'posted'::text, p_user_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text, p_source_event_id text DEFAULT NULL::text)
 RETURNS card_expenses
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := coalesce(p_user_id, (select auth.uid()));
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_installment_count integer := greatest(1, least(coalesce(p_installment_count, 1), 36));
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_spent_at date := coalesce(p_spent_at, private.today_ist());
  v_status text := case
    when lower(btrim(coalesce(p_status, 'posted'))) = 'provision' then 'provision'
    else 'posted'
  end;
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Diğer');
  v_current_period_amount numeric(14, 2) := 0;
  v_source text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'manual');
  v_source_event_id text := nullif(btrim(coalesce(p_source_event_id, '')), '');
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutari 0''dan buyuk olmali.';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama aciklamasi zorunlu.';
  end if;

  if v_source_event_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_user_id::text || '|' || v_source || '|' || v_source_event_id,
      0
    ));

    -- BM-6: iptal edilmiş satır kimliği rezerve etmez; yeniden import taze
    -- kayıt oluşturur (iptali geri almanın kanonik yolu).
    select *
    into v_expense
    from public.card_expenses
    where user_id = v_user_id
      and source = v_source
      and source_event_id = v_source_event_id
      and status <> 'cancelled';

    if found then
      return v_expense;
    end if;
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

  if v_card.card_type = 'banka_karti' and v_card.current_balance < p_amount then
    raise exception 'Banka karti bakiyesi yetersiz.';
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_status = 'posted' then
    if v_installment_count > 1 then
      for v_installment_no in 1..v_installment_count loop
        v_installment_amount := round(p_amount / v_installment_count, 2);
        if v_installment_no = v_installment_count then
          v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
        end if;

        v_due_month := (v_spent_at + ((v_installment_no - 1) * interval '1 month'))::date;
        if v_due_month <= private.today_ist() then
          v_current_period_amount := v_current_period_amount + v_installment_amount;
        end if;
      end loop;
    else
      v_current_period_amount := p_amount;
    end if;
  end if;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + v_current_period_amount,
        provision_amount = provision_amount + case when v_status = 'provision' then p_amount else 0 end,
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance - p_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  insert into public.card_expenses (
    user_id, card_id, spent_at, amount, description, category,
    installment_count, installment_amount, status, posted_at, source, source_event_id
  ) values (
    v_user_id, p_card_id, v_spent_at, p_amount, btrim(coalesce(p_description, '')), v_category,
    v_installment_count, v_first_installment_amount, v_status,
    case when v_status = 'posted' then now() else null end, v_source, v_source_event_id
  )
  returning * into v_expense;

  if v_card.card_type = 'kredi_karti' and v_status = 'posted' and v_installment_count > 1 then
    for v_installment_no in 1..v_installment_count loop
      v_installment_amount := round(p_amount / v_installment_count, 2);
      if v_installment_no = v_installment_count then
        v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
      end if;
      v_due_month := (v_spent_at + ((v_installment_no - 1) * interval '1 month'))::date;

      insert into public.card_installments (
        user_id, card_id, card_expense_id, installment_no, installment_count,
        due_month, amount, description, category, status, posted_at
      ) values (
        v_user_id, p_card_id, v_expense.id, v_installment_no, v_installment_count,
        v_due_month, v_installment_amount, btrim(coalesce(p_description, '')), v_category,
        case when v_due_month <= private.today_ist() then 'posted' else 'scheduled' end,
        case when v_due_month <= private.today_ist() then now() else null end
      );
    end loop;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id, 'card', btrim(coalesce(p_description, '')), p_amount, 'card_expenses', v_expense.id,
    case
      when v_status = 'provision' then 'Kart harcamasi provizyona alindi.'
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcamasi.'
      else 'Pesin kart harcamasi.'
    end
  );

  return v_expense;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.contribute_to_goal_bucket(p_bucket_id uuid, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_reserved numeric;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Ayrılacak tutar 0''dan büyük olmalı.';
  end if;

  update public.kasa_buckets
  set reserved_amount = reserved_amount + p_amount,
      last_contribution_month = date_trunc('month', private.today_ist())::date,
      updated_at = now()
  where id = p_bucket_id
    and user_id = v_user_id
  returning reserved_amount into v_reserved;

  if not found then
    raise exception 'Kova bulunamadı.';
  end if;

  return v_reserved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cut_card_statement(p_card_id uuid, p_statement_date date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date)
 RETURNS card_statement_archives
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_archive public.card_statement_archives%rowtype;
  v_statement_amount numeric(14, 2);
  v_due_month_start date;
  v_due_date date;
  v_due_day integer;
  v_period_year integer;
  v_period_month integer;
  v_boundary date;
  v_this_boundary date;
  v_prev_month_start date;
  v_next_period_spending numeric(14, 2) := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstre kesilecek kredi kartı bulunamadı.';
  end if;

  if v_card.statement_day is not null then
    v_this_boundary := make_date(
      extract(year from private.today_ist())::integer,
      extract(month from private.today_ist())::integer,
      least(
        v_card.statement_day,
        extract(day from (date_trunc('month', private.today_ist())::date + interval '1 month - 1 day'))::integer
      )
    );
    if private.today_ist() > v_this_boundary then
      v_boundary := v_this_boundary;
    else
      v_prev_month_start := (date_trunc('month', private.today_ist()) - interval '1 month')::date;
      v_boundary := make_date(
        extract(year from v_prev_month_start)::integer,
        extract(month from v_prev_month_start)::integer,
        least(
          v_card.statement_day,
          extract(day from (v_prev_month_start + interval '1 month - 1 day'))::integer
        )
      );
    end if;
  else
    v_boundary := private.today_ist();
  end if;

  if p_statement_date is not null then
    if abs(p_statement_date - v_boundary) > 7 then
      raise exception 'PDF kesim tarihi (%) kartın ekstre takviminden (%) 7 günden fazla sapıyor; kartın kesim gününü kontrol et.',
        p_statement_date, v_boundary;
    end if;
    v_boundary := p_statement_date;
  end if;

  v_period_year := extract(year from v_boundary)::integer;
  v_period_month := extract(month from v_boundary)::integer;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_card.id::text || ':' || v_period_year::text || ':' || v_period_month::text, 0)
  );

  select *
  into v_archive
  from public.card_statement_archives
  where user_id = v_user_id
    and card_id = v_card.id
    and period_year = v_period_year
    and period_month = v_period_month
  order by created_at desc
  limit 1;

  if found then
    return v_archive;
  end if;

  if v_card.current_period_spending <= 0 then
    raise exception 'Dönem içi harcama olmadığı için kesilecek ekstre yok.';
  end if;

  select coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_expenses
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and current_settlement_id is null
    and installment_count <= 1
    and spent_at > v_boundary;

  select v_next_period_spending + coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_installments
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month > v_boundary;

  v_statement_amount := greatest(0, v_card.current_period_spending - v_next_period_spending);

  if v_statement_amount <= 0 then
    raise exception 'Dönem içi harcama olmadığı için kesilecek ekstre yok.';
  end if;

  if v_card.due_day is not null then
    v_due_month_start := date_trunc('month', v_boundary)::date;
    -- 2d: vade günü kesim gününe eşit/önce ise vadeyi bir sonraki aya taşı,
    -- yoksa arşiv due_date = statement_date çakışır (TS ikizi ile hizalı).
    if v_card.statement_day is not null and v_card.due_day <= v_card.statement_day then
      v_due_month_start := (v_due_month_start + interval '1 month')::date;
    end if;
    v_due_day := least(
      v_card.due_day,
      extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer
    );
    v_due_date := v_due_month_start + (v_due_day - 1);
  end if;

  if p_due_date is not null then
    if p_due_date <= v_boundary or p_due_date - v_boundary > 45 then
      raise exception 'PDF son ödeme tarihi (%) kesim tarihine (%) göre geçersiz.',
        p_due_date, v_boundary;
    end if;
    v_due_date := p_due_date;
  end if;

  insert into public.card_statement_archives (
    user_id, card_id, period_year, period_month, statement_date, due_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status, note
  )
  values (
    v_user_id, v_card.id, v_period_year, v_period_month, v_boundary, v_due_date,
    v_statement_amount, v_statement_amount, v_card.debt_amount, 'open',
    v_card.card_name || ' ekstresi kesildi.'
  )
  returning * into v_archive;

  perform set_config('app.card_statement_allocation_user_id', v_user_id::text, true);

  update public.card_expenses
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and current_settlement_id is null
    and installment_count <= 1
    and spent_at <= v_boundary;

  update public.card_installments
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month <= v_boundary;

  perform set_config('app.card_statement_allocation_user_id', '', true);

  update public.cards
  set statement_debt_amount = statement_debt_amount + v_statement_amount,
      current_period_spending = v_next_period_spending,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id, 'card', v_card.card_name || ' ekstresi kesildi', v_statement_amount,
    'card_statement_archives', v_archive.id,
    'Dönem borcu ekstreye aktarıldı. Erken kapatılmış hareketler ve vadesi gelmemiş taksitler dışarıda bırakıldı.'
  );

  return v_archive;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cut_due_card_statements()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_card record;
  v_count integer := 0;
  v_boundary date;
  v_this_boundary date;
  v_prev_month_start date;
  v_period_year integer;
  v_period_month integer;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  for v_card in
    select cards.id, cards.statement_day
    from public.cards
    where cards.user_id = v_user_id
      and cards.card_type = 'kredi_karti'
      and cards.current_period_spending > 0
      and cards.statement_day is not null
  loop
    v_this_boundary := make_date(
      extract(year from private.today_ist())::integer,
      extract(month from private.today_ist())::integer,
      least(
        v_card.statement_day,
        extract(day from (date_trunc('month', private.today_ist())::date + interval '1 month - 1 day'))::integer
      )
    );
    if private.today_ist() > v_this_boundary then
      v_boundary := v_this_boundary;
    else
      v_prev_month_start := (date_trunc('month', private.today_ist()) - interval '1 month')::date;
      v_boundary := make_date(
        extract(year from v_prev_month_start)::integer,
        extract(month from v_prev_month_start)::integer,
        least(
          v_card.statement_day,
          extract(day from (v_prev_month_start + interval '1 month - 1 day'))::integer
        )
      );
    end if;

    v_period_year := extract(year from v_boundary)::integer;
    v_period_month := extract(month from v_boundary)::integer;

    if not exists (
      select 1
      from public.card_statement_archives
      where card_statement_archives.user_id = v_user_id
        and card_statement_archives.card_id = v_card.id
        and card_statement_archives.period_year = v_period_year
        and card_statement_archives.period_month = v_period_month
    ) then
      begin
        perform public.cut_card_statement(v_card.id);
        v_count := v_count + 1;
      exception
        when others then
          if sqlstate = 'P0001'
            and sqlerrm = 'Dönem içi harcama olmadığı için kesilecek ekstre yok.'
          then
            null;
          else
            raise;
          end if;
      end;
    end if;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_card_debt(p_card_id uuid, p_source_card_id uuid, p_amount numeric, p_skip_source_debit boolean DEFAULT false)
 RETURNS cards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_paid_card public.cards%rowtype;
  v_settlement public.card_current_settlements%rowtype;
  v_repair_settlement public.card_current_settlements%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_payable_amount numeric(14, 2);
  v_remaining_payment numeric(14, 2);
  v_next_statement_debt numeric(14, 2);
  v_next_current_period numeric(14, 2);
  v_single_total numeric(14, 2) := 0;
  v_installment_total numeric(14, 2) := 0;
  v_unallocated_total numeric(14, 2) := 0;
  v_historical_single_total numeric(14, 2) := 0;
  v_historical_installment_total numeric(14, 2) := 0;
  v_historical_total numeric(14, 2) := 0;
  v_unallocated_excess numeric(14, 2) := 0;
  v_residual numeric(14, 2) := 0;
  v_this_boundary date;
  v_previous_month_start date;
  v_cycle_start date;
  v_is_full_current_settlement boolean := false;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if v_amount <= 0 then
    raise exception 'Ödeme tutarı 0''dan büyük olmalı.';
  end if;

  if p_card_id = p_source_card_id then
    raise exception 'Kaynak hesap ve borç kartı aynı olamaz.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Borç ödenecek kredi kartı bulunamadı.';
  end if;

  v_payable_amount := greatest(0, v_card.statement_debt_amount + v_card.current_period_spending);

  if v_payable_amount <= 0 then
    raise exception 'Ödenecek kesinleşmiş kart borcu yok.';
  end if;

  if v_amount > v_payable_amount then
    raise exception 'Ödeme tutarı ekstre ve dönem içi kesinleşmiş kart borcundan büyük olamaz.';
  end if;

  v_is_full_current_settlement :=
    v_card.statement_debt_amount = 0
    and v_amount = v_card.current_period_spending;

  if v_is_full_current_settlement then
    select coalesce(sum(amount), 0)
    into v_single_total
    from public.card_expenses
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and installment_count <= 1
      and statement_archive_id is null
      and current_settlement_id is null;

    select coalesce(sum(amount), 0)
    into v_installment_total
    from public.card_installments
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and statement_archive_id is null
      and current_settlement_id is null;

    v_unallocated_total := round(v_single_total + v_installment_total, 2);
    v_unallocated_excess := round(v_unallocated_total - v_card.current_period_spending, 2);

    if v_unallocated_excess > 0 and v_card.statement_day is not null then
      v_this_boundary := make_date(
        extract(year from private.today_ist())::integer,
        extract(month from private.today_ist())::integer,
        least(
          v_card.statement_day,
          extract(day from (date_trunc('month', private.today_ist())::date + interval '1 month - 1 day'))::integer
        )
      );

      if private.today_ist() > v_this_boundary then
        v_cycle_start := v_this_boundary + 1;
      else
        v_previous_month_start := (date_trunc('month', private.today_ist()) - interval '1 month')::date;
        v_cycle_start := make_date(
          extract(year from v_previous_month_start)::integer,
          extract(month from v_previous_month_start)::integer,
          least(
            v_card.statement_day,
            extract(day from (v_previous_month_start + interval '1 month - 1 day'))::integer
          )
        ) + 1;
      end if;

      select coalesce(sum(amount), 0)
      into v_historical_single_total
      from public.card_expenses
      where user_id = v_user_id
        and card_id = v_card.id
        and status = 'posted'
        and installment_count <= 1
        and statement_archive_id is null
        and current_settlement_id is null
        and spent_at < v_cycle_start;

      select coalesce(sum(amount), 0)
      into v_historical_installment_total
      from public.card_installments
      where user_id = v_user_id
        and card_id = v_card.id
        and status = 'posted'
        and statement_archive_id is null
        and current_settlement_id is null
        and due_month < v_cycle_start;

      v_historical_total := round(v_historical_single_total + v_historical_installment_total, 2);

      if v_historical_total = v_unallocated_excess then
        insert into public.card_current_settlements (
          user_id, card_id, source_card_id, amount, settled_at, note, settlement_kind
        )
        values (
          v_user_id,
          v_card.id,
          null,
          v_historical_total,
          now(),
          'Eski aggregate kart ödemesinin eksik hareket dağılımı onarıldı; yeni nakit çıkışı yaratılmadı.',
          'historical_repair'
        )
        returning * into v_repair_settlement;

        perform set_config(
          'app.card_current_settlement_allocation_user_id',
          v_user_id::text,
          true
        );

        update public.card_expenses
        set current_settlement_id = v_repair_settlement.id,
            updated_at = now()
        where user_id = v_user_id
          and card_id = v_card.id
          and status = 'posted'
          and installment_count <= 1
          and statement_archive_id is null
          and current_settlement_id is null
          and spent_at < v_cycle_start;

        update public.card_installments
        set current_settlement_id = v_repair_settlement.id,
            status = 'paid',
            paid_at = now(),
            updated_at = now()
        where user_id = v_user_id
          and card_id = v_card.id
          and status = 'posted'
          and statement_archive_id is null
          and current_settlement_id is null
          and due_month < v_cycle_start;

        perform set_config('app.card_current_settlement_allocation_user_id', '', true);

        insert into public.transaction_history (
          user_id, type, title, amount, source_table, source_id, note
        ) values (
          v_user_id,
          'correction',
          v_card.card_name || ' tarihsel ödeme dağılımı onarıldı',
          v_historical_total,
          'card_current_settlements',
          v_repair_settlement.id,
          'Eski aggregate ödeme hareketlere bağlandı; hesap bakiyesi ve kart toplamı değişmedi.'
        );

        v_single_total := round(v_single_total - v_historical_single_total, 2);
        v_installment_total := round(v_installment_total - v_historical_installment_total, 2);
      end if;
    end if;

    -- B1: Sert eşitlik reddi yok. Kova-satır farkı (satırsız kova oynatan
    -- meşru yollardan kalan) residual olarak kapatılır: tüm allocation'sız
    -- satırlar bu ödemenin settlement'ına bağlanır, fark denetlenebilir
    -- şekilde kaydedilir. Pozitif residual = satırsız kova artışı da bu
    -- ödemeyle kapandı; negatif = satır toplamı kovadan büyüktü (ör. satırsız
    -- iade düzeltmesi) ve satırlar yine tek kanıta bağlandı.
    v_residual := round(v_card.current_period_spending - (v_single_total + v_installment_total), 2);
  end if;

  if p_skip_source_debit then
    -- B4: Bakiye banka/SMS tarafından zaten düşülmüş; yalnız doğrula, düşme.
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
    v_source := private.debit_bank_account(p_source_card_id, v_amount);
  end if;

  if v_is_full_current_settlement then
    insert into public.card_current_settlements (
      user_id, card_id, source_card_id, amount, settled_at, note, settlement_kind
    )
    values (
      v_user_id,
      v_card.id,
      v_source.id,
      v_amount,
      now(),
      case
        when v_residual = 0 then 'Ekstre kesilmeden güncel borcun tamamı ödendi.'
        else format(
          'Ekstre kesilmeden güncel borcun tamamı ödendi. Kova-satır farkı (%s TL) residual olarak bu ödemeyle kapatıldı.',
          v_residual
        )
      end,
      'payment'
    )
    returning * into v_settlement;

    perform set_config(
      'app.card_current_settlement_allocation_user_id',
      v_user_id::text,
      true
    );

    update public.card_expenses
    set current_settlement_id = v_settlement.id,
        updated_at = now()
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and installment_count <= 1
      and statement_archive_id is null
      and current_settlement_id is null;

    update public.card_installments
    set current_settlement_id = v_settlement.id,
        status = 'paid',
        paid_at = now(),
        updated_at = now()
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and statement_archive_id is null
      and current_settlement_id is null;

    perform set_config('app.card_current_settlement_allocation_user_id', '', true);

    if v_residual <> 0 then
      insert into public.transaction_history (
        user_id, type, title, amount, source_table, source_id, note
      ) values (
        v_user_id,
        'correction',
        v_card.card_name || ' kova-satır farkı ödemeyle kapatıldı',
        abs(v_residual),
        'card_current_settlements',
        v_settlement.id,
        format(
          'Tam güncel ödeme sırasında kova ile hareket toplamı arasında %s TL fark vardı (satırsız düzeltme/iade/kısmi ödeme kalıntısı). Fark bu ödemenin settlement kaydına bağlandı; ek nakit hareketi yok.',
          v_residual
        )
      );
    end if;
  end if;

  v_remaining_payment := v_amount;
  v_next_statement_debt := greatest(0, v_card.statement_debt_amount - v_remaining_payment);
  v_remaining_payment := greatest(0, v_remaining_payment - v_card.statement_debt_amount);
  v_next_current_period := greatest(0, v_card.current_period_spending - v_remaining_payment);

  update public.cards
  set debt_amount = greatest(0, debt_amount - v_amount),
      statement_debt_amount = v_next_statement_debt,
      current_period_spending = v_next_current_period,
      updated_at = now()
  where id = v_card.id
  returning * into v_paid_card;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_card.card_name || case
      when v_is_full_current_settlement then ' güncel borcu kapatıldı'
      else ' kart borcu ödendi'
    end,
    v_amount,
    case when v_is_full_current_settlement then 'card_current_settlements' else 'cards' end,
    case when v_is_full_current_settlement then v_settlement.id else v_card.id end,
    v_source.card_name || case
      when p_skip_source_debit
      then ' hesabındaki bakiye banka/SMS hareketiyle zaten düşülmüştü; tekrar düşülmedi. '
      else ' hesabından ödendi. '
    end || case
      when v_is_full_current_settlement
      then 'Dönem içi hareketler ve vadesi gelmiş taksitler erken kapatıldı.'
      else 'Gelecek kredi kartı taksitleri kapatılmadı.'
    end
  );

  return v_paid_card;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_payment(p_payment_id uuid, p_source_card_id uuid, p_paid_amount numeric DEFAULT NULL::numeric)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_payment public.payments%rowtype;
  v_paid_payment public.payments%rowtype;
  v_source public.cards%rowtype;
  v_paid_amount numeric(14, 2);
  v_next_month_start date;
  v_next_month_end date;
  v_next_due_day integer;
  v_next_due_date date;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_payment
  from public.payments
  where id = p_payment_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Odeme bulunamadi.';
  end if;

  if v_payment.status <> 'bekliyor' then
    raise exception 'Bu odeme bekliyor durumunda degil.';
  end if;

  v_paid_amount := round(coalesce(p_paid_amount, v_payment.amount), 2);

  if v_paid_amount <= 0 then
    raise exception 'Odeme tutari 0 dan buyuk olmali.';
  end if;

  -- Read the source card to determine bank vs credit card path.
  select *
  into v_source
  from public.cards
  where id = p_source_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kaynak hesap bulunamadi.';
  end if;

  if v_source.card_type = 'banka_karti' then
    -- Bank path: delegate to shared helper (re-lock is a no-op).
    v_source := private.debit_bank_account(p_source_card_id, v_paid_amount);
  elsif v_source.card_type = 'kredi_karti' then
    -- Credit card path: add as card spending (different logic, stays inline).
    update public.cards
    set debt_amount = debt_amount + v_paid_amount,
        current_period_spending = current_period_spending + v_paid_amount,
        updated_at = now()
    where id = v_source.id;

    insert into public.card_expenses (
      user_id,
      card_id,
      spent_at,
      amount,
      description,
      category,
      installment_count,
      installment_amount,
      status,
      posted_at,
      note
    )
    values (
      v_user_id,
      v_source.id,
      private.today_ist(),
      v_paid_amount,
      v_payment.title,
      v_payment.category,
      1,
      v_paid_amount,
      'posted',
      now(),
      'Odeme kaydindan olusturuldu. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
    );
  else
    raise exception 'Kaynak kart tipi desteklenmiyor.';
  end if;

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
      set amount = v_paid_amount,
          amount_status = 'exact',
          status = 'ödendi',
          updated_at = now()
      where id = v_payment.id
      returning * into v_paid_payment;
    else
      update public.payments
      set amount = v_paid_amount,
          amount_status = case
            when v_payment.payment_method = 'bank_auto' or v_payment.amount_status = 'estimated' then 'estimated'
            else 'exact'
          end,
          due_date = v_next_due_date,
          status = 'bekliyor',
          updated_at = now()
      where id = v_payment.id
      returning * into v_paid_payment;
    end if;
  else
    update public.payments
    set amount = v_paid_amount,
        amount_status = 'exact',
        status = 'ödendi',
        updated_at = now()
    where id = v_payment.id
    returning * into v_paid_payment;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_payment.title || ' odendi',
    v_paid_amount,
    'payments',
    v_payment.id,
    case
      when v_source.card_type = 'kredi_karti'
        then v_source.card_name || ' kredi kartina harcama olarak islendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
      else v_source.card_name || ' hesabindan odendi. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD')
    end
  );

  return v_paid_payment;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_card_provision(p_expense_id uuid, p_post_amount numeric DEFAULT NULL::numeric)
 RETURNS card_expenses
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_posted_expense public.card_expenses%rowtype;
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_post_amount numeric(14, 2);
  v_remaining_amount numeric(14, 2);
  v_is_partial boolean;
  v_current_period_amount numeric(14, 2) := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Provizyon bulunamadi.';
  end if;

  if v_expense.status <> 'provision' then
    raise exception 'Bu islem provizyonda degil.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_expense.card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  v_post_amount := round(coalesce(p_post_amount, v_expense.amount), 2);

  if v_post_amount <= 0 then
    raise exception 'Aktarilacak provizyon tutari 0 dan buyuk olmali.';
  end if;

  if v_post_amount > v_expense.amount then
    raise exception 'Aktarilacak tutar kalan provizyondan buyuk olamaz.';
  end if;

  v_remaining_amount := round(v_expense.amount - v_post_amount, 2);
  v_is_partial := v_remaining_amount > 0;
  v_first_installment_amount := case
    when v_expense.installment_count = 1 then v_post_amount
    else round(v_post_amount / v_expense.installment_count, 2)
  end;

  -- Vadesi gecmis taksitlerin TOPLAMI donem icine girer (yalniz ilki degil);
  -- vade isleme gununden turetilir (ay basi degil).
  if v_expense.installment_count > 1 then
    for v_installment_no in 1..v_expense.installment_count loop
      v_installment_amount := round(v_post_amount / v_expense.installment_count, 2);
      if v_installment_no = v_expense.installment_count then
        v_installment_amount := v_post_amount - (round(v_post_amount / v_expense.installment_count, 2) * (v_expense.installment_count - 1));
      end if;

      v_due_month := (v_expense.spent_at + ((v_installment_no - 1) * interval '1 month'))::date;
      if v_due_month <= private.today_ist() then
        v_current_period_amount := v_current_period_amount + v_installment_amount;
      end if;
    end loop;
  else
    v_current_period_amount := v_post_amount;
  end if;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set provision_amount = greatest(0, provision_amount - v_post_amount),
        current_period_spending = current_period_spending + v_current_period_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  if v_is_partial then
    update public.card_expenses
    set amount = v_remaining_amount,
        installment_amount = case
          when installment_count = 1 then v_remaining_amount
          else round(v_remaining_amount / installment_count, 2)
        end,
        updated_at = now()
    where id = v_expense.id;

    insert into public.card_expenses (
      user_id,
      card_id,
      spent_at,
      amount,
      description,
      category,
      installment_count,
      installment_amount,
      status,
      posted_at,
      note,
      context_id
    )
    values (
      v_user_id,
      v_card.id,
      v_expense.spent_at,
      v_post_amount,
      v_expense.description,
      v_expense.category,
      v_expense.installment_count,
      v_first_installment_amount,
      'posted',
      now(),
      v_expense.note,
      v_expense.context_id
    )
    returning * into v_posted_expense;
  else
    update public.card_expenses
    set status = 'posted',
        posted_at = now(),
        installment_amount = v_first_installment_amount,
        updated_at = now()
    where id = v_expense.id
    returning * into v_posted_expense;
  end if;

  if v_card.card_type = 'kredi_karti' and v_expense.installment_count > 1 and not exists (
    select 1
    from public.card_installments
    where card_expense_id = v_posted_expense.id
  ) then
    for v_installment_no in 1..v_expense.installment_count loop
      v_installment_amount := round(v_post_amount / v_expense.installment_count, 2);
      if v_installment_no = v_expense.installment_count then
        v_installment_amount := v_post_amount - (round(v_post_amount / v_expense.installment_count, 2) * (v_expense.installment_count - 1));
      end if;

      v_due_month := (v_expense.spent_at + ((v_installment_no - 1) * interval '1 month'))::date;

      insert into public.card_installments (
        user_id,
        card_id,
        card_expense_id,
        installment_no,
        installment_count,
        due_month,
        amount,
        description,
        category,
        status,
        posted_at
      )
      values (
        v_user_id,
        v_card.id,
        v_posted_expense.id,
        v_installment_no,
        v_expense.installment_count,
        v_due_month,
        v_installment_amount,
        v_expense.description,
        v_expense.category,
        case when v_due_month <= private.today_ist() then 'posted' else 'scheduled' end,
        case when v_due_month <= private.today_ist() then now() else null end
      );
    end loop;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    v_expense.description || case when v_is_partial then ' provizyonu kismen kesinlesti' else ' provizyonu kesinlesti' end,
    v_post_amount,
    'card_expenses',
    v_posted_expense.id,
    case
      when v_is_partial then 'Provizyonun bir kismi donem icine aktarildi; kalan tutar provizyonda bekliyor.'
      else 'Provizyon donem icine aktarildi.'
    end
  );

  return v_posted_expense;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_due_card_installments()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_card record;
  v_amount numeric(14, 2);
  v_updated integer;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  for v_card in
    select distinct card_id
    from public.card_installments
    where user_id = v_user_id
      and status = 'scheduled'
      and statement_archive_id is null
      and due_month <= private.today_ist()
  loop
    perform 1
    from public.cards
    where id = v_card.card_id
      and user_id = v_user_id
      and card_type = 'kredi_karti'
    for update;

    if not found then
      continue;
    end if;

    with updated as (
      update public.card_installments
      set status = 'posted',
          posted_at = now(),
          updated_at = now()
      where user_id = v_user_id
        and card_id = v_card.card_id
        and status = 'scheduled'
        and statement_archive_id is null
        and due_month <= private.today_ist()
      returning amount
    )
    select coalesce(sum(amount), 0), count(*)
    into v_amount, v_updated
    from updated;

    if v_updated > 0 then
      update public.cards
      set current_period_spending = current_period_spending + v_amount,
          updated_at = now()
      where id = v_card.card_id;

      v_count := v_count + v_updated;
    end if;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_sms_card_expense(p_card_id uuid, p_amount numeric, p_description text, p_spent_at timestamp with time zone, p_category text, p_user_id uuid, p_source_event_id text)
 RETURNS card_expenses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text := (select auth.role());
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_spent_at date := coalesce((p_spent_at at time zone 'Europe/Istanbul')::date, private.today_ist());
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
$function$
;

CREATE OR REPLACE FUNCTION public.replace_card_statement_import(p_card_id uuid, p_statement_date date, p_due_date date, p_bank_amount numeric, p_actions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_action jsonb;
  v_kind text;
  v_preserved_expense public.card_expenses%rowtype;
  v_archive public.card_statement_archives%rowtype;
  v_archive_ids uuid[] := array[]::uuid[];
  v_rebuild_expense_ids uuid[] := array[]::uuid[];
  v_delete_expense_ids uuid[] := array[]::uuid[];
  v_delete_installment_ids uuid[] := array[]::uuid[];
  v_existing_expense_id uuid;
  v_total_installments integer;
  v_paid_installments integer;
  v_installment_amount numeric(14, 2);
  v_due_month date;
  v_current_amount numeric(14, 2);
  v_remaining_amount numeric(14, 2);
  v_baseline_statement numeric(14, 2);
  v_baseline_current numeric(14, 2);
  v_baseline_provision numeric(14, 2);
  v_baseline_scheduled numeric(14, 2);
  v_candidate_statement numeric(14, 2);
  v_residual numeric(14, 2);
  v_statement_adjustments numeric(14, 2) := 0;
  v_aggregate_delta numeric(14, 2);
  v_reuse_candidate_count integer;
  v_imported_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_statement_date is null then
    raise exception 'Ekstre kesim tarihi zorunlu.';
  end if;

  if p_bank_amount is null or p_bank_amount < 0 then
    raise exception 'Ekstre banka toplamı geçersiz.';
  end if;

  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'Ekstre aksiyonları dizi olmalı.';
  end if;

  perform 1
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
    and card_type = 'kredi_karti'
  for update;

  if not found then
    raise exception 'Kredi kartı bulunamadı.';
  end if;

  -- K2: Ödenmiş dönemin (veya daha eski bir dönemin) PDF'i yeniden import
  -- edilemez. Silme kapsamı yalnız açık arşivleri tanır; ödenmiş dönemde
  -- yeniden oynatma borcu ikinci kez ekler ve korunan planların açık
  -- taksitlerini siler. Belirti yerine kaynağında açık hata veriyoruz.
  if exists (
    select 1
    from public.card_statement_archives
    where card_id = p_card_id
      and user_id = v_user_id
      and coalesce(status, 'open') = 'paid'
      and statement_date >= p_statement_date
  ) then
    raise exception 'Bu kartta % kesim tarihli veya daha yeni ödenmiş ekstre var; ödenmiş bir dönemin PDF''i yeniden import edilemez.',
      p_statement_date;
  end if;

  -- Bu kartın açık ekstresi yeniden üretilebilir; paid arşivler tarihsel kanıttır.
  select coalesce(array_agg(id), array[]::uuid[])
  into v_archive_ids
  from public.card_statement_archives
  where card_id = p_card_id
    and user_id = v_user_id
    and coalesce(status, 'open') = 'open';

  -- PDF tarihine kadar olan açık harcamalar ile onların tüm açık taksit planı
  -- yeniden kurulur. PDF tarihinden sonraki tek çekim/provizyon hareketleri kalır.
  select coalesce(array_agg(distinct expense_id), array[]::uuid[])
  into v_rebuild_expense_ids
  from (
    select expense.id as expense_id
    from public.card_expenses expense
    where expense.card_id = p_card_id
      and expense.user_id = v_user_id
      and expense.current_settlement_id is null
      and (
        expense.statement_archive_id = any(v_archive_ids)
        or (expense.statement_archive_id is null and expense.spent_at <= p_statement_date)
      )

    union

    select installment.card_expense_id
    from public.card_installments installment
    where installment.card_id = p_card_id
      and installment.user_id = v_user_id
      and installment.card_expense_id is not null
      and installment.current_settlement_id is null
      and (
        installment.statement_archive_id = any(v_archive_ids)
        or (installment.statement_archive_id is null and installment.due_month <= p_statement_date)
      )
  ) scope
  where expense_id is not null;

  -- Paid/current-settled çocuk taşıyan parent korunur. Diğer parent'lar yeniden
  -- yaratılmak üzere silinir. Korunan parent'a ait yalnız açık çocuklar yenilenir.
  select coalesce(array_agg(expense.id), array[]::uuid[])
  into v_delete_expense_ids
  from public.card_expenses expense
  where expense.id = any(v_rebuild_expense_ids)
    and expense.user_id = v_user_id
    and expense.current_settlement_id is null
    and not exists (
      select 1
      from public.card_installments child
      left join public.card_statement_archives archive
        on archive.id = child.statement_archive_id
      where child.card_expense_id = expense.id
        and (
          child.current_settlement_id is not null
          or (child.statement_archive_id is not null and coalesce(archive.status, 'open') = 'paid')
        )
    );

  select coalesce(array_agg(installment.id), array[]::uuid[])
  into v_delete_installment_ids
  from public.card_installments installment
  left join public.card_statement_archives archive
    on archive.id = installment.statement_archive_id
  where installment.card_id = p_card_id
    and installment.user_id = v_user_id
    and installment.card_expense_id = any(v_rebuild_expense_ids)
    and installment.current_settlement_id is null
    and not (
      installment.statement_archive_id is not null
      and coalesce(archive.status, 'open') = 'paid'
    );

  delete from public.transaction_history
  where user_id = v_user_id
    and (
      (source_table = 'card_installments' and source_id = any(v_delete_installment_ids))
      or (source_table = 'card_expenses' and source_id = any(v_delete_expense_ids))
      or (source_table = 'card_statement_archives' and source_id = any(v_archive_ids))
    );

  -- DELETE bypass yalnız bu fonksiyonun user/card filtreli sorgularında kullanılır.
  perform set_config('app.finance_data_reset_user_id', v_user_id::text, true);

  delete from public.card_installments
  where id = any(v_delete_installment_ids)
    and card_id = p_card_id
    and user_id = v_user_id;

  delete from public.card_expenses
  where id = any(v_delete_expense_ids)
    and card_id = p_card_id
    and user_id = v_user_id;

  delete from public.card_statement_archives
  where id = any(v_archive_ids)
    and card_id = p_card_id
    and user_id = v_user_id;

  perform set_config('app.finance_data_reset_user_id', '', true);

  -- Korunan PDF-sonrası/audit kapsamından kartın canlı başlangıç projeksiyonunu
  -- tekrar üret. Taksit parent'ı ayrıca sayılmaz; açık child'lar borcun kendisidir.
  select coalesce(sum(statement_debt_amount), 0)
  into v_baseline_statement
  from public.card_statement_archives
  where card_id = p_card_id
    and user_id = v_user_id
    and coalesce(status, 'open') = 'open';

  select coalesce(sum(amount), 0)
  into v_baseline_current
  from public.card_expenses expense
  where expense.card_id = p_card_id
    and expense.user_id = v_user_id
    and expense.status = 'posted'
    and expense.installment_count <= 1
    and expense.statement_archive_id is null
    and expense.current_settlement_id is null;

  select v_baseline_current + coalesce(sum(amount), 0)
  into v_baseline_current
  from public.card_installments installment
  where installment.card_id = p_card_id
    and installment.user_id = v_user_id
    and installment.status = 'posted'
    and installment.statement_archive_id is null
    and installment.current_settlement_id is null;

  select coalesce(sum(amount), 0)
  into v_baseline_provision
  from public.card_expenses expense
  where expense.card_id = p_card_id
    and expense.user_id = v_user_id
    and expense.status = 'provision'
    and expense.statement_archive_id is null
    and expense.current_settlement_id is null;

  select coalesce(sum(amount), 0)
  into v_baseline_scheduled
  from public.card_installments installment
  where installment.card_id = p_card_id
    and installment.user_id = v_user_id
    and installment.status = 'scheduled'
    and installment.statement_archive_id is null
    and installment.current_settlement_id is null;

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', 'Ekstre PDF yeniden kurulum başlangıç projeksiyonu', true);

  update public.cards
  set debt_amount = round(v_baseline_statement + v_baseline_current + v_baseline_provision + v_baseline_scheduled, 2),
      statement_debt_amount = round(v_baseline_statement, 2),
      current_period_spending = round(v_baseline_current, 2),
      provision_amount = round(v_baseline_provision, 2),
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;

  perform set_config('app.ledger_kind', '', true);
  perform set_config('app.ledger_note', '', true);

  for v_action in select value from jsonb_array_elements(p_actions)
  loop
    v_kind := coalesce(v_action ->> 'kind', '');

    if v_kind = 'expense' then
      perform public.add_card_expense(
        p_card_id => p_card_id,
        p_amount => (v_action ->> 'amount')::numeric,
        p_description => v_action ->> 'description',
        p_spent_at => (v_action ->> 'spentAt')::date,
        p_installment_count => (v_action ->> 'installmentCount')::integer,
        p_category => coalesce(nullif(v_action ->> 'category', ''), 'Diğer'),
        p_status => 'posted',
        p_user_id => null,
        p_source => 'statement_import',
        p_source_event_id => nullif(v_action ->> 'sourceEventId', '')
      );

    elsif v_kind = 'payment' then
      perform public.pay_payment_from_card_import(
        (v_action ->> 'paymentId')::uuid,
        p_card_id,
        (v_action ->> 'amount')::numeric,
        (v_action ->> 'spentAt')::date,
        nullif(v_action ->> 'sourceEventId', ''),
        'statement_import'
      );

    elsif v_kind = 'adjustment' then
      v_installment_amount := round((v_action ->> 'amount')::numeric, 2);
      if v_installment_amount <= 0 then
        raise exception 'Ekstre alacak/iade tutarı pozitif olmalı.';
      end if;
      v_statement_adjustments := v_statement_adjustments - v_installment_amount;

    elsif v_kind = 'carryover' then
      v_existing_expense_id := nullif(v_action ->> 'existingExpenseId', '')::uuid;
      v_total_installments := (v_action ->> 'totalInstallments')::integer;
      v_paid_installments := (v_action ->> 'paidInstallments')::integer;
      v_installment_amount := round((v_action ->> 'installmentAmount')::numeric, 2);
      v_due_month := (v_action ->> 'nextDueDate')::date;

      -- K1: UI parent id göndermiyorsa süregiden plan sunucuda aranır. Aksi
      -- halde her aylık import, ödenmiş geçmişi korunan aynı plana yeni bir
      -- parent açar ve harcama listesi/kategori analizi ay be ay mükerrerleşir.
      -- Eşleşme bilinçli olarak dar: aynı kart + aynı taksit adedi + birebir
      -- (normalize) açıklama + ödenmiş/settled geçmişi olan (yani silme
      -- kapsamından korunmuş) parent + PDF sırasıyla çelişen açık child yok.
      -- Tam olarak TEK aday varsa yeniden kullanılır; belirsizlik yeni parent'a
      -- düşer (SI-08/09'daki gevşek istemci eşleştirme sınıfına dönmemek için).
      if v_existing_expense_id is null then
        select count(*), min(expense.id::text)::uuid
        into v_reuse_candidate_count, v_existing_expense_id
        from public.card_expenses expense
        where expense.card_id = p_card_id
          and expense.user_id = v_user_id
          and expense.status = 'posted'
          and expense.installment_count = v_total_installments
          and upper(btrim(expense.description)) = upper(btrim(coalesce(v_action ->> 'description', '')))
          and exists (
            select 1
            from public.card_installments child
            left join public.card_statement_archives archive
              on archive.id = child.statement_archive_id
            where child.card_expense_id = expense.id
              and (
                child.current_settlement_id is not null
                or (child.statement_archive_id is not null and coalesce(archive.status, 'open') = 'paid')
              )
          )
          and not exists (
            select 1
            from public.card_installments child
            where child.card_expense_id = expense.id
              and child.installment_no > v_paid_installments
          );

        if v_reuse_candidate_count is distinct from 1 then
          v_existing_expense_id := null;
        end if;
      end if;

      select * into v_preserved_expense
      from public.card_expenses
      where id = v_existing_expense_id
        and card_id = p_card_id
        and user_id = v_user_id
      for update;

      if found then
        if v_preserved_expense.installment_count <> v_total_installments then
          raise exception 'Ödenmiş geçmişi olan taksit planının taksit adedi PDF ile uyuşmuyor; tarihsel parent otomatik değiştirilemez.';
        end if;

        if exists (
          select 1
          from public.card_installments installment
          where installment.card_expense_id = v_preserved_expense.id
            and installment.installment_no > v_paid_installments
        ) then
          raise exception 'Korunan taksit geçmişi PDF''deki cari taksit numarasıyla çakışıyor.';
        end if;

        v_current_amount := 0;
        v_remaining_amount := 0;
        for v_installment_no in (v_paid_installments + 1)..v_total_installments
        loop
          v_due_month := ((v_action ->> 'nextDueDate')::date
            + ((v_installment_no - v_paid_installments - 1) || ' month')::interval)::date;

          insert into public.card_installments (
            user_id, card_id, card_expense_id, installment_no, installment_count,
            due_month, amount, description, category, status, posted_at, paid_at, note
          ) values (
            v_user_id, p_card_id, v_preserved_expense.id, v_installment_no, v_total_installments,
            v_due_month, v_installment_amount, v_action ->> 'description',
            coalesce(nullif(v_action ->> 'category', ''), 'Diğer'),
            case when v_due_month <= private.today_ist() then 'posted' else 'scheduled' end,
            case when v_due_month <= private.today_ist() then now() else null end,
            null,
            case
              when abs(v_preserved_expense.amount - round(v_installment_amount * v_total_installments, 2)) > 1
                then format(
                  'Ekstre PDF kaynak gerçeğinden yeniden kuruldu. Tarihsel parent toplamı %s TL korundu; PDF taksit projeksiyonu %s TL.',
                  v_preserved_expense.amount,
                  round(v_installment_amount * v_total_installments, 2)
                )
              else 'Ekstre PDF kaynak gerçeğinden yeniden kuruldu.'
            end
          );

          v_remaining_amount := v_remaining_amount + v_installment_amount;
          if v_due_month <= private.today_ist() then
            v_current_amount := v_current_amount + v_installment_amount;
          end if;
        end loop;

        update public.cards
        set debt_amount = debt_amount + round(v_remaining_amount, 2),
            current_period_spending = current_period_spending + round(v_current_amount, 2),
            updated_at = now()
        where id = p_card_id and user_id = v_user_id;

      else
        perform public.record_card_installment_carryover(
          p_card_id,
          v_action ->> 'description',
          v_installment_amount,
          v_total_installments,
          v_paid_installments,
          v_due_month,
          coalesce(nullif(v_action ->> 'category', ''), 'Diğer'),
          nullif(v_action ->> 'sourceEventId', '')
        );
      end if;
    else
      raise exception 'Desteklenmeyen ekstre aksiyonu: %', v_kind;
    end if;

    v_imported_count := v_imported_count + 1;
  end loop;

  -- PDF toplamı yalnız ekstre kesim kapsamının kaynağıdır. Sonraki dönem
  -- hareketlerini bozmadan, kesilecek miktarı banka toplamına getir.
  select coalesce(sum(amount), 0)
  into v_candidate_statement
  from public.card_expenses expense
  where expense.card_id = p_card_id
    and expense.user_id = v_user_id
    and expense.status = 'posted'
    and expense.installment_count <= 1
    and expense.statement_archive_id is null
    and expense.current_settlement_id is null
    and expense.spent_at <= p_statement_date;

  select v_candidate_statement + coalesce(sum(amount), 0)
  into v_candidate_statement
  from public.card_installments installment
  where installment.card_id = p_card_id
    and installment.user_id = v_user_id
    and installment.status = 'posted'
    and installment.statement_archive_id is null
    and installment.current_settlement_id is null
    and installment.due_month <= p_statement_date;

  v_candidate_statement := round(v_candidate_statement + v_statement_adjustments, 2);

  v_residual := round(p_bank_amount - v_candidate_statement, 2);
  v_aggregate_delta := round(v_statement_adjustments + v_residual, 2);
  if v_aggregate_delta <> 0 then
    if v_candidate_statement + v_residual < 0 then
      raise exception 'Ekstre toplamı negatif projeksiyon üretiyor.';
    end if;

    perform set_config('app.ledger_kind', 'adjustment', true);
    perform set_config('app.ledger_note', 'Ekstre PDF banka toplamına atomik kilit', true);
    update public.cards
    set debt_amount = greatest(0, debt_amount + v_aggregate_delta),
        current_period_spending = greatest(0, current_period_spending + v_aggregate_delta),
        updated_at = now()
    where id = p_card_id and user_id = v_user_id;
    perform set_config('app.ledger_kind', '', true);
    perform set_config('app.ledger_note', '', true);
  end if;

  -- K3: PDF tarihleri kesime otorite olarak taşınır; sınır üyeliği yukarıdaki
  -- p_statement_date kapsamıyla birebir aynı olur.
  v_archive := public.cut_card_statement(p_card_id, p_statement_date, p_due_date);

  if v_archive.statement_date <> p_statement_date then
    raise exception 'PDF kesim tarihi (%) kartın hesaplanan kesim tarihiyle (%) uyuşmuyor.',
      p_statement_date, v_archive.statement_date;
  end if;

  if p_due_date is not null and v_archive.due_date is distinct from p_due_date then
    raise exception 'PDF son ödeme tarihi (%) kartın hesaplanan tarihiyle (%) uyuşmuyor.',
      p_due_date, v_archive.due_date;
  end if;

  perform public.set_statement_reconciliation(
    p_card_id,
    extract(year from p_statement_date)::integer,
    extract(month from p_statement_date)::integer,
    p_bank_amount,
    'Ekstre PDF kaynak gerçeğinden atomik yeniden kuruldu.'
  );

  return jsonb_build_object(
    'importedCount', v_imported_count,
    'statementId', v_archive.id,
    'bankAmount', round(p_bank_amount, 2)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_scheduled_card_maintenance(p_provision_stale_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user record;
  v_expense record;
  v_user_count integer := 0;
  v_statements_cut integer := 0;
  v_installments_posted integer := 0;
  v_provisions_posted integer := 0;
  v_cut integer;
  v_posted integer;
begin
  for v_user in
    select distinct user_id
    from public.cards
    where card_type = 'kredi_karti'
  loop
    v_user_count := v_user_count + 1;

    perform set_config('request.jwt.claim.sub', v_user.user_id::text, true);

    begin
      v_posted := public.post_due_card_installments();
      v_installments_posted := v_installments_posted + coalesce(v_posted, 0);
    exception
      when others then
        raise notice 'Taksit post islemi basarisiz (kullanici %): %', v_user.user_id, sqlerrm;
    end;

    begin
      v_cut := public.cut_due_card_statements();
      v_statements_cut := v_statements_cut + coalesce(v_cut, 0);
    exception
      when others then
        raise notice 'Ekstre kesimi basarisiz (kullanici %): %', v_user.user_id, sqlerrm;
    end;

    for v_expense in
      select id
      from public.card_expenses
      where user_id = v_user.user_id
        and status = 'provision'
        and spent_at <= (private.today_ist() - p_provision_stale_days)
    loop
      begin
        perform public.post_card_provision(v_expense.id);
        v_provisions_posted := v_provisions_posted + 1;
      exception
        when others then
          raise notice 'Provizyon dusurme basarisiz (harcama %): %', v_expense.id, sqlerrm;
      end;
    end loop;
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);

  return jsonb_build_object(
    'users', v_user_count,
    'statements_cut', v_statements_cut,
    'installments_posted', v_installments_posted,
    'provisions_posted', v_provisions_posted,
    'provision_stale_days', p_provision_stale_days,
    'ran_at', now()
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_card_expense(p_expense_id uuid, p_amount numeric, p_description text, p_spent_at date DEFAULT NULL::date, p_installment_count integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS card_expenses
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_initial_card_id uuid;
  v_expense public.card_expenses%rowtype;
  v_card public.cards%rowtype;
  v_installment_count integer;
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_spent_at date;
  v_category text;
  v_posted_period_amount numeric(14, 2) := 0;
  v_paid_before integer := 0;
  v_start_installment_no integer := 1;
  v_current_period_amount numeric(14, 2) := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutari 0''dan buyuk olmali.';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama aciklamasi zorunlu.';
  end if;

  -- Statement cutting locks card -> children. Use the same order here to avoid
  -- a child -> card / card -> child deadlock. Re-read the expense under lock
  -- after locking the card because the first lookup is intentionally unlocked.
  select card_id
  into v_initial_card_id
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Harcama bulunamadi.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_initial_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
    and card_id = v_card.id
  for update;

  if not found then
    raise exception 'Harcama bulunamadi veya karti degisti; yeniden deneyin.';
  end if;

  if v_expense.status <> 'posted' then
    raise exception 'Sadece kesinlesmis harcamalar duzenlenebilir.';
  end if;

  -- cut_card_statement locks this same card before allocating children. Check
  -- only after that lock so a concurrent cut cannot attach an installment
  -- between this decision and the edit's child-row rebuild.
  if v_expense.statement_archive_id is not null
     or exists (
       select 1
       from public.card_installments installment
       where installment.card_expense_id = v_expense.id
         and installment.statement_archive_id is not null
     ) then
    raise exception 'Ekstreye kesilmis kart harcamasi duzenlenemez.';
  end if;

  v_installment_count := greatest(1, least(coalesce(p_installment_count, v_expense.installment_count), 36));
  v_spent_at := coalesce(p_spent_at, v_expense.spent_at);
  v_category := coalesce(nullif(btrim(coalesce(p_category, '')), ''), v_expense.category);

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

  -- Devreden plan notu geçmiş taksit sayısını taşır; iki format da tanınır.
  -- Eski RPC: "N/M taksiti uygulama öncesinde ödendi."
  -- 20260809190000: "N/M taksit ekstre öncesinde tamamlandı; yalnız açık plan tutulur."
  -- Tanınmazsa düzenleme geçmiş taksitleri sıfır sayıp planı 1..M yeniden kurar.
  if v_expense.note ~ '^[0-9]+/[0-9]+ taksiti uygulama [oö]ncesinde [oö]dendi\.$' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksiti uygulama [oö]ncesinde [oö]dendi\.$'))[1]::integer
    ));
    v_start_installment_no := v_paid_before + 1;
  elsif v_expense.note ~ '^[0-9]+/[0-9]+ taksit ekstre [oö]ncesinde tamamland[iı]' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksit ekstre [oö]ncesinde tamamland[iı]'))[1]::integer
    ));
    v_start_installment_no := v_paid_before + 1;
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_card.card_type = 'kredi_karti' then
    select coalesce(sum(amount), 0)
    into v_posted_period_amount
    from public.card_installments
    where card_expense_id = v_expense.id
      and status = 'posted';

    if v_posted_period_amount = 0 then
      v_posted_period_amount := case
        when v_expense.installment_count <= 1 then v_expense.amount
        else v_expense.installment_amount
      end;
    end if;

    update public.cards
    set debt_amount = greatest(0, debt_amount - v_expense.amount),
        current_period_spending = greatest(0, current_period_spending - v_posted_period_amount),
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance + v_expense.amount,
        updated_at = now()
    where id = v_card.id;

    -- Bakiye kontrolu IADE SONRASI degeri kullanmali: v_card iade oncesi
    -- okundu, guncel bakiye v_card.current_balance + v_expense.amount.
    -- Eskisi yanlis red uretiyordu (bakiye 0, eski 100, yeni 50 -> hata).
    if v_card.current_balance + v_expense.amount < p_amount then
      raise exception 'Banka karti bakiyesi yetersiz.';
    end if;
  end if;

  delete from public.card_installments
  where card_expense_id = v_expense.id;

  update public.card_expenses
  set spent_at = v_spent_at,
      amount = p_amount,
      description = btrim(coalesce(p_description, '')),
      category = v_category,
      installment_count = v_installment_count,
      installment_amount = v_first_installment_amount,
      note = coalesce(p_note, v_expense.note),
      updated_at = now()
  where id = v_expense.id
  returning * into v_expense;

  if v_card.card_type = 'kredi_karti' then
    if v_installment_count > 1 then
      for v_installment_no in v_start_installment_no..v_installment_count loop
        v_installment_amount := round(p_amount / v_installment_count, 2);
        if v_installment_no = v_installment_count then
          v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
        end if;

        v_due_month := (v_spent_at + ((v_installment_no - 1) * interval '1 month'))::date;
        if v_due_month <= private.today_ist() then
          v_current_period_amount := v_current_period_amount + v_installment_amount;
        end if;
      end loop;
    else
      v_current_period_amount := p_amount;
    end if;

    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + v_current_period_amount,
        updated_at = now()
    where id = v_card.id;

    if v_installment_count > 1 then
      for v_installment_no in v_start_installment_no..v_installment_count loop
        v_installment_amount := round(p_amount / v_installment_count, 2);
        if v_installment_no = v_installment_count then
          v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
        end if;

        v_due_month := (v_spent_at + ((v_installment_no - 1) * interval '1 month'))::date;

        insert into public.card_installments (
          user_id,
          card_id,
          card_expense_id,
          installment_no,
          installment_count,
          due_month,
          amount,
          description,
          category,
          status,
          posted_at
        )
        values (
          v_user_id,
          v_card.id,
          v_expense.id,
          v_installment_no,
          v_installment_count,
          v_due_month,
          v_installment_amount,
          btrim(coalesce(p_description, '')),
          v_category,
          case when v_due_month <= private.today_ist() then 'posted' else 'scheduled' end,
          case when v_due_month <= private.today_ist() then now() else null end
        );
      end loop;
    end if;
  else
    update public.cards
    set current_balance = current_balance - p_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  return v_expense;
end;
$function$
;

