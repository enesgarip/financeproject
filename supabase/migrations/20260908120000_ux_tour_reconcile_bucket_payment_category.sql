-- UX turu 2026-09-08 mantık paketi (docs/UX_WALKTHROUGH_2026-09-08.md B1, B5):
--
-- B1  reconcile_card_bank_snapshot artık farkı bir kovaya da yazabilir.
--     Eski üç parametreli imza aynen "yalnız toplam" davranışıyla kalır
--     (import modalı ve eski çağıranlar); yeni dört parametreli imza
--     p_bucket = 'current' | 'statement' | 'none' alır. Pozitif fark seçilen
--     kovaya eklenir, negatif fark yalnız toplamı düşürür (clamp trigger'ı
--     kovaları borca kırpar). Böylece uygulamanın kendi düzeltmesi Veri
--     Sağlığı'nda "borç kırılımında eksik pay" bulgusu üretmez.
--
-- B5  pay_payment kredi kartı yolu: planlı ödeme kategorisi (Sigorta, Kira /
--     aidat, Dijital üyelik, Vergi / devlet) kart taksonomisine eşlenir ve
--     harcama source='payment_auto' + source_event_id='payment:<id>:<ts>' ile
--     işaretlenir. TS ikizi: src/utils/categories.ts cardCategoryFromPayment.

-- ---------------------------------------------------------------------------
-- B5: kategori eşlemesi (saf, TS ikizi ile birebir)
-- ---------------------------------------------------------------------------
create or replace function private.card_category_from_payment(p_category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_category in (
      'Market', 'Yeme & İçme', 'Ulaşım', 'Alışveriş', 'Fatura', 'Sağlık', 'Eğlence',
      'Eğitim', 'Konut', 'Abonelik', 'İş', 'Kişisel Bakım', 'Hediye', 'Finansman'
    ) then p_category
    when p_category in ('Sigorta', 'Vergi / devlet') then 'Finansman'
    when p_category = 'Kira / aidat' then 'Konut'
    when p_category = 'Dijital üyelik' then 'Abonelik'
    else 'Diğer'
  end;
$$;

revoke execute on function private.card_category_from_payment(text) from public;
revoke execute on function private.card_category_from_payment(text) from anon;
grant execute on function private.card_category_from_payment(text) to authenticated;

-- ---------------------------------------------------------------------------
-- B5: pay_payment — kart yolunda kategori eşlemesi + kaynak damgası
-- ---------------------------------------------------------------------------
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

    -- Kategori kart taksonomisine eşlenir (B5); source/source_event_id ile
    -- "kartla ödenen planlı ödeme" aylık raporda nakit çıkışı sayılmaz (B4).
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
      source,
      source_event_id
    )
    values (
      v_user_id,
      v_source.id,
      private.today_ist(),
      v_paid_amount,
      v_payment.title,
      private.card_category_from_payment(v_payment.category),
      1,
      v_paid_amount,
      'posted',
      now(),
      'Odeme kaydindan olusturuldu. Vade: ' || to_char(v_payment.due_date, 'YYYY-MM-DD'),
      'payment_auto',
      'payment:' || v_payment.id::text || ':' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS')
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

-- ---------------------------------------------------------------------------
-- B1: reconcile_card_bank_snapshot(p_bucket)
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_card_bank_snapshot(
  p_card_id uuid,
  p_bank_total_kurus bigint,
  p_note text,
  p_bucket text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_archive public.card_statement_archives%rowtype;
  v_bank_total numeric(14, 2);
  v_minimum_visible numeric(14, 2);
  v_linked_total numeric(14, 2);
  v_candidate_total numeric(14, 2);
  v_gap numeric(14, 2);
  v_delta numeric(14, 2);
  v_bucket text := coalesce(nullif(btrim(coalesce(p_bucket, '')), ''), 'none');
  v_repaired_count integer;
  v_updated_count integer;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_bank_total_kurus is null or p_bank_total_kurus < 0 then
    raise exception 'Bankadaki toplam kart yükü negatif olamaz.';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'Mutabakat için açıklama zorunlu.';
  end if;

  if v_bucket not in ('none', 'current', 'statement') then
    raise exception 'Geçersiz kova: % (none | current | statement bekleniyor).', v_bucket;
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
    and card_type = 'kredi_karti'
  for update;

  if not found then
    raise exception 'Mutabakat yapılacak kredi kartı bulunamadı.';
  end if;

  -- Eski sürümlerde ekstre aggregate olarak ödenmiş, fakat bazı çocuklar
  -- arşive bağlanmadan kalmış olabilir. Yalnız mevcut bağlı toplam + tarihe
  -- kadar olan tüm açık adaylar arşiv tutarına TAM eşitse bağlantı kurulur.
  -- Belirsiz/kısmi eşleşmede hiçbir tarihsel satıra dokunulmaz.
  for v_archive in
    select *
    from public.card_statement_archives
    where user_id = v_user_id
      and card_id = p_card_id
      and status = 'paid'
    order by statement_date, id
    for update
  loop
    select round(
      coalesce((
        select sum(expense.amount)
        from public.card_expenses expense
        where expense.user_id = v_user_id
          and expense.card_id = p_card_id
          and expense.status <> 'cancelled'
          and expense.installment_count <= 1
          and expense.statement_archive_id = v_archive.id
      ), 0)
      + coalesce((
        select sum(installment.amount)
        from public.card_installments installment
        where installment.user_id = v_user_id
          and installment.card_id = p_card_id
          and installment.statement_archive_id = v_archive.id
      ), 0),
      2
    ) into v_linked_total;

    select round(
      coalesce((
        select sum(expense.amount)
        from public.card_expenses expense
        where expense.user_id = v_user_id
          and expense.card_id = p_card_id
          and expense.status = 'posted'
          and expense.installment_count <= 1
          and expense.statement_archive_id is null
          and expense.current_settlement_id is null
          and expense.spent_at <= v_archive.statement_date
      ), 0)
      + coalesce((
        select sum(installment.amount)
        from public.card_installments installment
        where installment.user_id = v_user_id
          and installment.card_id = p_card_id
          and installment.status = 'posted'
          and installment.statement_archive_id is null
          and installment.current_settlement_id is null
          and installment.due_month <= v_archive.statement_date
      ), 0),
      2
    ) into v_candidate_total;

    v_gap := round(v_archive.statement_debt_amount - v_linked_total, 2);

    if v_gap > 0 and v_candidate_total = v_gap then
      perform set_config('app.card_statement_allocation_user_id', v_user_id::text, true);

      update public.card_expenses
      set statement_archive_id = v_archive.id,
          updated_at = now()
      where user_id = v_user_id
        and card_id = p_card_id
        and status = 'posted'
        and installment_count <= 1
        and statement_archive_id is null
        and current_settlement_id is null
        and spent_at <= v_archive.statement_date;

      get diagnostics v_repaired_count = row_count;

      update public.card_installments
      set statement_archive_id = v_archive.id,
          updated_at = now()
      where user_id = v_user_id
        and card_id = p_card_id
        and status = 'posted'
        and statement_archive_id is null
        and current_settlement_id is null
        and due_month <= v_archive.statement_date;

      get diagnostics v_updated_count = row_count;
      v_repaired_count := v_repaired_count + v_updated_count;
      perform set_config('app.card_statement_allocation_user_id', '', true);

      insert into public.transaction_history (
        user_id, type, title, amount, source_table, source_id, note
      ) values (
        v_user_id,
        'correction',
        v_card.card_name || ' tarihsel ekstre bağlantısı onarıldı',
        v_gap,
        'card_statement_archives',
        v_archive.id,
        format('%s hareket banka tutarıyla tam eşleşti. %s', v_repaired_count, btrim(p_note))
      );
    end if;
  end loop;

  v_bank_total := p_bank_total_kurus / 100.0;
  v_minimum_visible := round(
    greatest(0, v_card.statement_debt_amount)
      + greatest(0, v_card.current_period_spending)
      + greatest(0, v_card.provision_amount),
    2
  );

  if v_bank_total < v_minimum_visible then
    raise exception 'Banka toplamı görünür ekstre/dönem/provizyon toplamından küçük olamaz.';
  end if;

  v_delta := round(v_bank_total - v_card.debt_amount, 2);

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', btrim(p_note), true);

  -- Pozitif fark seçilen kovaya da yazılır: dönem içi (varsayılan UI seçimi)
  -- ya da ekstre. Negatif fark yalnız toplamı düşürür; clamp trigger'ı kovaları
  -- borca kırpar. 'none' eski toplam-only davranışıdır.
  update public.cards
  set debt_amount = v_bank_total,
      current_period_spending = case
        when v_bucket = 'current' and v_delta > 0 then current_period_spending + v_delta
        else current_period_spending
      end,
      statement_debt_amount = case
        when v_bucket = 'statement' and v_delta > 0 then statement_debt_amount + v_delta
        else statement_debt_amount
      end,
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;

  perform set_config('app.ledger_kind', '', true);
  perform set_config('app.ledger_note', '', true);

  return v_bank_total;
end;
$$;

revoke execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text, text) from public;
revoke execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text, text) from anon;
grant execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text, text) to authenticated;

-- Eski imza: davranış korunur (yalnız toplam), gövde tek yerde yaşar.
create or replace function public.reconcile_card_bank_snapshot(
  p_card_id uuid,
  p_bank_total_kurus bigint,
  p_note text
)
returns numeric
language sql
security definer
set search_path = ''
as $$
  select public.reconcile_card_bank_snapshot(p_card_id, p_bank_total_kurus, p_note, 'none');
$$;

revoke execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text) from public;
revoke execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text) from anon;
grant execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text) to authenticated;
