-- Faz Abonelik: tutar değişse de kurum + kart + dönem kanıtıyla eşleştir.
-- Yalnız plan ve append-only geçmiş yazılır; mevcut harcama/borç/ledger değişmez.
alter table public.payments
  add column match_merchant text,
  add column match_reference text,
  add column match_amount numeric(14,2) check (match_amount > 0);
alter table public.transaction_history
  add column matched_card_expense_id uuid,
  add column payment_due_date date;
-- source_id gibi tarihsel kimliktir; harcama arşivden silinse de kanıt kalır.
create unique index transaction_history_payment_expense_unique
  on public.transaction_history(user_id, matched_card_expense_id)
  where matched_card_expense_id is not null and type = 'payment';
create unique index transaction_history_payment_period_unique
  on public.transaction_history(user_id, source_id, payment_due_date)
  where payment_due_date is not null and type = 'payment' and source_table = 'payments';

create or replace function private.payment_match_key(p_value text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(translate(coalesce(p_value,''), 'IİıŞşĞğÜüÖöÇç', 'iiiSsGgUuOoCc')), '[^a-z0-9]+', ' ', 'g'));
$$;
create or replace function private.payment_provider(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case
    when k ~ '^su( faturasi)?$|\m(buski|iski|aski)\M' then 'water'
    when k ~ '^elektrik( faturasi)?$|\m(uludag elektrik|enerjisa|uedas)\M' then 'electricity'
    when k ~ '^(dogalgaz|dogal gaz)( faturasi)?$|\m(igdas|bursagaz)\M|\maksa\M.*\m(dogalgaz|dogal gaz)\M' then 'gas'
    when k ~ '^internet( faturasi)?$|\m(turknet|superonline|turk telekom internet)\M' then 'internet'
    when k ~ '^telefon( faturasi)?$|\m(turk telekom mobil|vodafone|turkcell)\M' then 'mobile'
    when k ~ '\micloud\M' then 'icloud'
    when k ~ '\m(chatgpt|openai)\M' then 'chatgpt'
    when k ~ '\mapple\M' then 'apple'
    else null end from (select private.payment_match_key(p_value) k) s;
$$;
create or replace function private.payment_description_matches(
  p_title text, p_merchant text, p_reference text, p_description text
) returns boolean language plpgsql immutable set search_path = '' as $$
declare
  e text := private.payment_match_key(coalesce(nullif(p_merchant,''),p_title));
  a text := private.payment_match_key(p_description);
  r text := private.payment_match_key(p_reference);
  ep text := private.payment_provider(e);
  ap text := private.payment_provider(a);
begin
  if e = '' or a = '' then return false; end if;
  if r <> '' and position(' ' || r || ' ' in ' ' || a || ' ') = 0 then return false; end if;
  if ep in ('icloud','chatgpt') and ap = 'apple' then return true; end if;
  if nullif(p_merchant,'') is not null then return position(' ' || e || ' ' in ' ' || a || ' ') > 0; end if;
  if ep is not null or ap is not null then
    return coalesce(ep = ap,false) and (e ~ '^(su|elektrik|dogalgaz|dogal gaz|internet|telefon)( faturasi)?$'
      or position(' ' || e || ' ' in ' ' || a || ' ') > 0);
  end if;
  return position(' ' || e || ' ' in ' ' || a || ' ') > 0;
end $$;
create or replace function private.payment_matches_expense(p public.payments, p_description text, p_amount numeric)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  provider text := private.payment_provider(coalesce(nullif(p.match_merchant,''),p.title));
begin
  if coalesce(p_amount,0) <= 0 or not private.payment_description_matches(p.title,p.match_merchant,p.match_reference,p_description) then return false; end if;
  if p.match_amount is not null or provider in ('icloud','chatgpt','apple') then
    return round(p_amount,2) = coalesce(p.match_amount,p.amount);
  end if;
  if p.amount_status = 'estimated' and provider in ('water','electricity','gas','internet','mobile') then return true; end if;
  return abs(p_amount - p.amount) <= 5;
end $$;

-- Bu kişisel uygulamada kullanıcı tarafından doğrulanan mevcut Apple planları.
-- Fiyatlar eşleştirme ayarıdır, genel matcher'a gömülmez; formdan değiştirilebilir.
update public.payments set match_amount = 169.99
where private.payment_match_key(title) in ('icloud','icloud plus')
  and payment_method = 'bank_auto' and match_amount is null;
update public.payments set match_amount = 499.99
where private.payment_match_key(title) = 'chatgpt'
  and payment_method = 'bank_auto' and match_amount is null;

create or replace function private.reconcile_card_payment_expenses(p_user_id uuid, p_card_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c public.cards%rowtype;
  p public.payments%rowtype;
  e public.card_expenses%rowtype;
  candidate_count integer;
  candidate_id uuid;
  competing integer;
  next_start date;
  next_due date;
  changed integer := 0;
begin
  if p_user_id is null then raise exception 'Oturum bulunamadı.'; end if;
  -- Kart → ödeme kilit sırası SMS ile aynı. Manuel ödeme kilidini bekleme.
  for c in select * from public.cards where user_id = p_user_id and card_type = 'kredi_karti'
    and (p_card_id is null or id = p_card_id) order by id for update
  loop
    for p in select * from public.payments where user_id = p_user_id
      and auto_source_card_id = c.id and payment_method = 'bank_auto' and status = 'bekliyor'
      order by due_date,id for update skip locked
    loop
      loop
        exit when p.status <> 'bekliyor' or p.due_date > private.today_ist() + 7;
        exit when p.recurrence_end_date is not null and p.due_date > p.recurrence_end_date;
        -- Yalnız sıradaki dönemden başla; kanıtsız boş ayı atlayarak ödeme uydurma.
        select count(*),(array_agg(x.id order by x.spent_at,x.id))[1] into candidate_count,candidate_id
        from public.card_expenses x where x.user_id = p_user_id and x.card_id = c.id
          and x.status in ('posted','provision') and x.installment_count = 1
          and x.spent_at <= private.today_ist() and abs(x.spent_at - p.due_date) <= 7
          and (x.source in ('sms','statement_import','movement_import') or x.source is null)
          and coalesce(x.note,'') not like 'Odeme kaydindan%'
          and coalesce(x.note,'') not like 'Odeme kaydiyla SMS%'
          and private.payment_matches_expense(p,x.description,x.amount)
          and not exists (select 1 from public.transaction_history h where h.user_id = p_user_id
            and h.type = 'payment' and h.matched_card_expense_id = x.id);
        exit when candidate_count <> 1;
        select * into e from public.card_expenses where id = candidate_id and user_id = p_user_id for update;
        select count(*) into competing from public.payments other
        where other.user_id = p_user_id and other.id <> p.id and other.status = 'bekliyor'
          and other.payment_method = 'bank_auto' and other.auto_source_card_id = c.id
          and abs(other.due_date - e.spent_at) <= 7
          and (other.recurrence_end_date is null or other.due_date <= other.recurrence_end_date)
          and private.payment_matches_expense(other,e.description,e.amount);
        exit when competing > 0;
        exit when exists (select 1 from public.transaction_history h where h.user_id = p_user_id
          and h.type = 'payment' and h.source_table = 'payments' and h.source_id = p.id
          and h.payment_due_date = p.due_date);
        insert into public.transaction_history(user_id,type,title,amount,source_table,source_id,note,
          occurred_at,matched_card_expense_id,payment_due_date)
        values(p_user_id,'payment',p.title || ' banka kaydıyla eşlendi',e.amount,'payments',p.id,
          'Mevcut kart harcamasıyla eşleşti; yeniden borç yazılmadı. Vade: ' || p.due_date::text,
          (e.spent_at + time '12:00') at time zone 'Europe/Istanbul',e.id,p.due_date);
        next_start := (date_trunc('month',p.due_date) + interval '1 month')::date;
        next_due := next_start + (least(coalesce(p.recurrence_day,extract(day from p.due_date)::integer),
          extract(day from next_start + interval '1 month - 1 day')::integer) - 1);
        update public.payments set amount = e.amount,
          amount_status = case when p.recurrence = 'monthly' and (p.recurrence_end_date is null or next_due <= p.recurrence_end_date) then 'estimated' else 'exact' end,
          status = case when p.recurrence = 'monthly' and (p.recurrence_end_date is null or next_due <= p.recurrence_end_date) then 'bekliyor' else 'ödendi' end,
          due_date = case when p.recurrence = 'monthly' and (p.recurrence_end_date is null or next_due <= p.recurrence_end_date) then next_due else p.due_date end,
          updated_at = now() where id = p.id and user_id = p_user_id returning * into p;
        changed := changed + 1;
      end loop;
    end loop;
  end loop;
  return changed;
end $$;
create or replace function public.reconcile_card_payment_expenses()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Oturum bulunamadı.'; end if;
  return private.reconcile_card_payment_expenses((select auth.uid()));
end $$;
revoke all on function private.payment_match_key(text), private.payment_provider(text),
  private.payment_description_matches(text,text,text,text), private.payment_matches_expense(public.payments,text,numeric),
  private.reconcile_card_payment_expenses(uuid,uuid) from public,anon,authenticated;
revoke all on function public.reconcile_card_payment_expenses() from public,anon;
grant execute on function public.reconcile_card_payment_expenses() to authenticated;

-- SMS aynı saf kuralları kullanır; idempotensi ve taksit niyeti korunur.
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
  v_expense public.card_expenses%rowtype;
  v_candidate_count integer := 0;
  v_candidate_id uuid;
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

  perform 1
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
    and private.payment_description_matches(description,null,null,v_description)
    and abs(spent_at - v_spent_at) <= 3
    and (private.payment_provider(description) not in ('icloud','chatgpt','apple')
      or amount = v_amount or private.payment_provider(description) is null)
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

  v_expense := public.add_card_expense(
    p_card_id => p_card_id,
    p_amount => v_amount,
    p_description => v_description,
    p_spent_at => v_spent_at,
    p_installment_count => 1,
    p_category => v_category,
    p_status => 'provision',
    p_user_id => p_user_id,
    p_source => 'sms',
    p_source_event_id => v_event_id
  );

  perform private.reconcile_card_payment_expenses(p_user_id,p_card_id);
  if not exists (select 1 from public.transaction_history where user_id = p_user_id
    and type = 'payment' and matched_card_expense_id = v_expense.id) then
    v_intent_expense := private.apply_card_installment_intent(v_expense.id,p_user_id);
    if v_intent_expense.id is not null then v_expense := v_intent_expense; end if;
  end if;
  return v_expense;
end;
$function$;
