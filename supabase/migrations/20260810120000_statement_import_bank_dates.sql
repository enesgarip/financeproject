-- Faz B1-1 (banka modeli, kanama durdurucular):
--
-- K2 — Ödenmiş dönemin PDF'i yeniden import edilemez. Silme kapsamı yalnız açık
--   arşivleri tanıdığı için ödenmiş dönem re-importu borcu ikinci kez ekler ve
--   korunan planların açık taksitlerini sessizce silerdi; açık hata güvenlidir.
--
-- K3 — Banka belgesi tarih otoritesidir. Ekstre kesim/son ödeme tarihi PDF'ten
--   geldiğinde, kartın takviminden türetilen sınıra ±7 gün mesafede olmak
--   şartıyla PDF tarihi kesim sınırı olur. Böylece bankanın hafta sonu/tatil
--   kaydırması importu kilitlemez ve dönem üyeliği (spent_at/due_month <= sınır)
--   RPC'nin PDF kapsamıyla birebir hizalanır. Tarihsiz çağrılar (günlük bakım,
--   client kesimi) davranışını korur.
--
-- T2b — update_card_expense yalnız eski carryover notunu ("N/M taksiti uygulama
--   öncesinde ödendi.") tanıyordu; 20260809190000'in yeni notu ("N/M taksit
--   ekstre öncesinde tamamlandı; ...") tanınmayınca düzenleme geçmiş taksitleri
--   sıfır sayıp planı 1..M olarak yeniden kurar ve borcu şişirirdi.

-- ── K3: cut_card_statement opsiyonel banka tarihleri alır ─────────────────────
-- İmza değiştiği için eski tek argümanlı fonksiyon düşürülür; tüm mevcut
-- çağıranlar (cut_due_card_statements, client rpc) default'larla uyumludur.

drop function if exists public.cut_card_statement(uuid);

create or replace function public.cut_card_statement(
  p_card_id uuid,
  p_statement_date date default null,
  p_due_date date default null
)
returns public.card_statement_archives
language plpgsql
set search_path = ''
as $$
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
      extract(year from current_date)::integer,
      extract(month from current_date)::integer,
      least(
        v_card.statement_day,
        extract(day from (date_trunc('month', current_date)::date + interval '1 month - 1 day'))::integer
      )
    );
    if current_date > v_this_boundary then
      v_boundary := v_this_boundary;
    else
      v_prev_month_start := (date_trunc('month', current_date) - interval '1 month')::date;
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
    v_boundary := current_date;
  end if;

  -- K3: PDF kesim tarihi verilmişse belge otoritedir. ±7 gün sınırı, yanlış
  -- ayın PDF'inin yanlış döneme kesilmesini engeller; banka kaydırmaları bu
  -- pencerenin çok içindedir.
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
    if v_card.statement_day is not null and v_card.due_day <= v_card.statement_day then
      v_due_month_start := (v_due_month_start + interval '1 month')::date;
    end if;
    v_due_day := least(
      v_card.due_day,
      extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer
    );
    v_due_date := v_due_month_start + (v_due_day - 1);
  end if;

  -- K3: PDF son ödeme tarihi de belge otoritesidir (banka tatil kaydırması
  -- burada en sık görülür). Kesimden önce veya 45 günden uzak olamaz.
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
$$;

revoke execute on function public.cut_card_statement(uuid, date, date) from public;
revoke execute on function public.cut_card_statement(uuid, date, date) from anon;
grant execute on function public.cut_card_statement(uuid, date, date) to authenticated;

-- ── K2 + K3: replace_card_statement_import ────────────────────────────────────
-- 20260809160000 gövdesi; iki değişiklik: (1) ödenmiş dönem re-import guard'ı,
-- (2) kesim, PDF tarihlerini otorite olarak cut_card_statement'a taşır. Sondaki
-- birebir eşitlik kontrolleri savunma olarak kalır (erken-dönen mevcut arşiv
-- PDF ile uyuşmuyorsa tüm import atomik geri alınır).

create or replace function public.replace_card_statement_import(
  p_card_id uuid,
  p_statement_date date,
  p_due_date date,
  p_bank_amount numeric,
  p_actions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
            case when v_due_month <= current_date then 'posted' else 'scheduled' end,
            case when v_due_month <= current_date then now() else null end,
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
          if v_due_month <= current_date then
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
$$;

revoke execute on function public.replace_card_statement_import(uuid, date, date, numeric, jsonb) from public;
revoke execute on function public.replace_card_statement_import(uuid, date, date, numeric, jsonb) from anon;
grant execute on function public.replace_card_statement_import(uuid, date, date, numeric, jsonb) to authenticated;

-- ── T2b: update_card_expense her iki carryover not formatını da tanır ─────────
-- 20260802200000 gövdesi; tek değişiklik geçmiş taksit sayısını taşıyan notun
-- yeni formatının da (20260809190000) okunmasıdır.

create or replace function public.update_card_expense(
  p_expense_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default null,
  p_installment_count integer default null,
  p_category text default null,
  p_note text default null
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $function$
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

    if v_card.current_balance < p_amount then
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
        if v_due_month <= current_date then
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
          case when v_due_month <= current_date then 'posted' else 'scheduled' end,
          case when v_due_month <= current_date then now() else null end
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
$function$;

revoke execute on function public.update_card_expense(uuid, numeric, text, date, integer, text, text) from public;
revoke execute on function public.update_card_expense(uuid, numeric, text, date, integer, text, text) from anon;
grant execute on function public.update_card_expense(uuid, numeric, text, date, integer, text, text) to authenticated;
