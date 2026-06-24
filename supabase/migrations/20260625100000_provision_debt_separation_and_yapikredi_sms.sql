-- Provizyon-borç ayrımı: provizyon artık debt_amount'u etkilemez.
-- Sadece provision_amount artar; kesinleşme sırasında debt_amount güncellenir.
-- Hesap numarası kolonu + SMS hesap hareketi RPC'si eklendi.
-- Yapı Kredi kart SMS desteği yalnız Edge Function tarafında.

-- 1) Mevcut provizyonların şişirdiği debt_amount'u düzelt
update public.cards
set debt_amount = greatest(0, debt_amount - provision_amount),
    updated_at = now()
where provision_amount > 0;

-- 2) add_card_expense: provizyon = sadece provision_amount, debt_amount'a dokunma
drop function if exists public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid);

create or replace function public.add_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default current_date,
  p_installment_count integer default 1,
  p_category text default 'Diğer',
  p_status text default 'posted',
  p_user_id uuid default null
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $function$
declare
  v_user_id uuid := coalesce(p_user_id, (select auth.uid()));
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_installment_count integer := greatest(1, least(coalesce(p_installment_count, 1), 36));
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_spent_at date := coalesce(p_spent_at, current_date);
  v_status text := case
    when lower(btrim(coalesce(p_status, 'posted'))) = 'provision' then 'provision'
    else 'posted'
  end;
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Diğer');
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutarı 0''dan büyük olmalı.';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama açıklaması zorunlu.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi kartı için kullanılabilir.';
  end if;

  if v_card.card_type = 'banka_karti' and v_card.current_balance < p_amount then
    raise exception 'Banka kartı bakiyesi yetersiz.';
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + case when v_status = 'posted' then p_amount else 0 end,
        current_period_spending = current_period_spending + case when v_status = 'posted' then v_first_installment_amount else 0 end,
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
    user_id,
    card_id,
    spent_at,
    amount,
    description,
    category,
    installment_count,
    installment_amount,
    status,
    posted_at
  )
  values (
    v_user_id,
    p_card_id,
    v_spent_at,
    p_amount,
    btrim(coalesce(p_description, '')),
    v_category,
    v_installment_count,
    v_first_installment_amount,
    v_status,
    case when v_status = 'posted' then now() else null end
  )
  returning * into v_expense;

  if v_card.card_type = 'kredi_karti' and v_status = 'posted' and v_installment_count > 1 then
    for v_installment_no in 1..v_installment_count loop
      v_installment_amount := round(p_amount / v_installment_count, 2);
      if v_installment_no = v_installment_count then
        v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
      end if;

      v_due_month := (date_trunc('month', v_spent_at)::date + ((v_installment_no - 1) * interval '1 month'))::date;

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
        p_card_id,
        v_expense.id,
        v_installment_no,
        v_installment_count,
        v_due_month,
        v_installment_amount,
        btrim(coalesce(p_description, '')),
        v_category,
        case when v_installment_no = 1 then 'posted' else 'scheduled' end,
        case when v_installment_no = 1 then now() else null end
      );
    end loop;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    btrim(coalesce(p_description, '')),
    p_amount,
    'card_expenses',
    v_expense.id,
    case
      when v_status = 'provision' then 'Kart harcaması provizyona alındı.'
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcaması.'
      else 'Peşin kart harcaması.'
    end
  );

  return v_expense;
end;
$function$;

grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid) to authenticated;
grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid) to service_role;

-- 3) post_card_provision: kesinleşirken debt_amount'a ekle
drop function if exists public.post_card_provision(uuid, numeric);

create or replace function public.post_card_provision(
  p_expense_id uuid,
  p_post_amount numeric default null
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
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

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + v_post_amount,
        provision_amount = greatest(0, provision_amount - v_post_amount),
        current_period_spending = current_period_spending + v_first_installment_amount,
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
      note
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
      v_expense.note
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

      v_due_month := (date_trunc('month', v_expense.spent_at)::date + ((v_installment_no - 1) * interval '1 month'))::date;

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
        case when v_installment_no = 1 then 'posted' else 'scheduled' end,
        case when v_installment_no = 1 then now() else null end
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
$$;

grant execute on function public.post_card_provision(uuid, numeric) to authenticated;

-- 4) cancel_card_expense: provizyon iptalinde debt_amount'a dokunma
drop function if exists public.cancel_card_expense(uuid);

create or replace function public.cancel_card_expense(
  p_expense_id uuid
)
returns public.card_expenses
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_cancelled public.card_expenses%rowtype;
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
    raise exception 'Harcama bulunamadi.';
  end if;

  if v_expense.status = 'cancelled' then
    raise exception 'Bu harcama zaten iptal edilmis.';
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

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = greatest(0, debt_amount - case when v_expense.status = 'posted' then v_expense.amount else 0 end),
        current_period_spending = greatest(0, current_period_spending - case when v_expense.status = 'posted' then v_expense.amount else 0 end),
        provision_amount = case
          when v_expense.status = 'provision'
          then greatest(0, provision_amount - v_expense.amount)
          else provision_amount
        end,
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance + v_expense.amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  delete from public.card_installments
  where card_expense_id = v_expense.id
    and user_id = v_user_id;

  update public.card_expenses
  set status = 'cancelled',
      updated_at = now()
  where id = v_expense.id
  returning * into v_cancelled;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'correction',
    v_expense.description || ' iptal edildi',
    v_expense.amount,
    'card_expenses',
    v_expense.id,
    'Mutabakat sirasinda iptal edildi. Orijinal tarih: ' || to_char(v_expense.spent_at, 'YYYY-MM-DD')
  );

  return v_cancelled;
end;
$$;

revoke execute on function public.cancel_card_expense(uuid) from public;
revoke execute on function public.cancel_card_expense(uuid) from anon;
grant execute on function public.cancel_card_expense(uuid) to authenticated;

-- 5) Hesap numarası kolonu (SMS ile hesap eşleştirmesi için)
alter table public.cards
add column if not exists account_number text;

-- 6) SMS hesap hareketi RPC'si (service_role uyumlu)
create or replace function public.record_sms_account_movement(
  p_account_number text,
  p_amount numeric,
  p_direction text,
  p_counterparty text,
  p_occurred_at timestamptz default now(),
  p_transaction_type text default null,
  p_user_id uuid default null
)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := coalesce(p_user_id, (select auth.uid()));
  v_card public.cards%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_normalized_account text;
begin
  if p_direction not in ('in', 'out') then
    raise exception 'Gecersiz hareket yonu.';
  end if;

  if v_amount <= 0 then
    raise exception 'Tutar 0 dan buyuk olmali.';
  end if;

  v_normalized_account := regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g');

  if v_normalized_account = '' then
    raise exception 'Hesap numarasi bos olamaz.';
  end if;

  if v_user_id is not null then
    select *
    into v_card
    from public.cards
    where user_id = v_user_id
      and card_type = 'banka_karti'
      and regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g') = v_normalized_account
    for update;
  else
    select *
    into v_card
    from public.cards
    where card_type = 'banka_karti'
      and regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g') = v_normalized_account
    for update;
  end if;

  if not found then
    raise exception 'Hesap numarasi "%" ile eslesecek banka hesabi bulunamadi.', p_account_number;
  end if;

  if p_direction = 'out' then
    update public.cards
    set current_balance = current_balance - v_amount,
        updated_at = now()
    where id = v_card.id
    returning * into v_card;
  else
    update public.cards
    set current_balance = current_balance + v_amount,
        updated_at = now()
    where id = v_card.id
    returning * into v_card;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_card.user_id,
    'transfer',
    case
      when p_direction = 'out' then p_counterparty || ' adina ' || coalesce(p_transaction_type, '') || ' gonderimi'
      else p_counterparty || ' tarafindan ' || coalesce(p_transaction_type, '') || ' geldi'
    end,
    v_amount,
    'cards',
    v_card.id,
    'SMS otomasyonu ile kaydedildi.'
  );

  return v_card;
end;
$$;

revoke execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) from public;
revoke execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) from anon;
grant execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) to authenticated;
grant execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) to service_role;
