-- Kredi kartından otomatik ödenen planlı faturalar ile aynı banka işlemini
-- bildiren SMS'in iki ayrı card_expenses kaydı üretmesini engeller.
-- SMS banka gerçeğidir; tek ve güvenli bir plan adayı varsa ödeme planını ilerletir.
-- SMS gelmezse otomatik görev bir günlük gecikmeyle mevcut fallback davranışını sürdürür.

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

revoke execute on function public.record_sms_card_expense(uuid, numeric, text, timestamptz, text, uuid, text) from public;
revoke execute on function public.record_sms_card_expense(uuid, numeric, text, timestamptz, text, uuid, text) from anon;
revoke execute on function public.record_sms_card_expense(uuid, numeric, text, timestamptz, text, uuid, text) from authenticated;
grant execute on function public.record_sms_card_expense(uuid, numeric, text, timestamptz, text, uuid, text) to service_role;

-- SMS'in vade gününde planı ilerletmesine zaman tanı. SMS hiç gelmezse ertesi gün
-- mevcut otomatik-postalama fallback'i çalışır. Kilitli ödeme satırı atlanır.
create or replace function public.post_due_card_auto_payments()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_payment public.payments%rowtype;
  v_count integer := 0;
  v_guard integer := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  loop
    select *
    into v_payment
    from public.payments
    where user_id = v_user_id
      and status = 'bekliyor'
      and payment_method = 'bank_auto'
      and auto_source_card_id is not null
      and amount > 0
      and due_date < current_date
      and exists (
        select 1
        from public.cards
        where cards.id = payments.auto_source_card_id
          and cards.user_id = v_user_id
          and cards.card_type = 'kredi_karti'
      )
    order by due_date asc
    for update skip locked
    limit 1;

    exit when not found;

    perform public.pay_payment(v_payment.id, v_payment.auto_source_card_id, v_payment.amount);
    v_count := v_count + 1;
    v_guard := v_guard + 1;
    exit when v_guard > 500;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.post_due_card_auto_payments() from anon;
revoke execute on function public.post_due_card_auto_payments() from public;
grant execute on function public.post_due_card_auto_payments() to authenticated;
