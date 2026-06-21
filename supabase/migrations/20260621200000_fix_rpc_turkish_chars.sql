-- RPC fonksiyonlarındaki Türkçe karakter tutarsızlığını düzelt.
-- Eski ASCII: bulunamadi → bulunamadı, oncesinde → öncesinde, odendi → ödendi, vb.
-- Ayrıca update_card_expense regex'ini hem eski hem yeni note formatını eşleştirecek
-- şekilde günceller.

-- ─── add_card_expense ────────────────────────────────────────────────────────

create or replace function public.add_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default current_date,
  p_installment_count integer default 1,
  p_category text default 'Diğer',
  p_status text default 'posted'
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
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
    set debt_amount = debt_amount + p_amount,
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

-- ─── update_card_expense ─────────────────────────────────────────────────────

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
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Harcama bulunamadı.';
  end if;

  if v_expense.status <> 'posted' then
    raise exception 'Sadece kesinleşmiş harcamalar düzenlenebilir.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_expense.card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  v_installment_count := greatest(1, least(coalesce(p_installment_count, v_expense.installment_count), 36));
  v_spent_at := coalesce(p_spent_at, v_expense.spent_at);
  v_category := coalesce(nullif(btrim(coalesce(p_category, '')), ''), v_expense.category);

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi kartı için kullanılabilir.';
  end if;

  -- Hem eski (ASCII) hem yeni (Türkçe) note formatını eşleştir.
  if v_expense.note ~ '^[0-9]+/[0-9]+ taksiti uygulama [oö]ncesinde [oö]dendi\.$' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksiti uygulama [oö]ncesinde [oö]dendi\.$'))[1]::integer
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
      raise exception 'Banka kartı bakiyesi yetersiz.';
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
    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + case
          when v_installment_count = 1 then p_amount
          else v_first_installment_amount
        end,
        updated_at = now()
    where id = v_card.id;

    if v_installment_count > 1 then
      for v_installment_no in v_start_installment_no..v_installment_count loop
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
          v_card.id,
          v_expense.id,
          v_installment_no,
          v_installment_count,
          v_due_month,
          v_installment_amount,
          btrim(coalesce(p_description, '')),
          v_category,
          case when v_installment_no = v_start_installment_no then 'posted' else 'scheduled' end,
          case when v_installment_no = v_start_installment_no then now() else null end
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

-- ─── record_card_installment_carryover ───────────────────────────────────────

create or replace function public.record_card_installment_carryover(
  p_card_id uuid,
  p_description text,
  p_installment_amount numeric,
  p_total_installments integer,
  p_paid_installments integer,
  p_next_due_month date,
  p_category text default 'Diğer'
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_installment_amount, 0), 2);
  v_total integer := coalesce(p_total_installments, 0);
  v_paid integer := coalesce(p_paid_installments, 0);
  v_remaining_count integer;
  v_remaining_amount numeric(14, 2);
  v_total_amount numeric(14, 2);
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Diğer');
  v_description text := btrim(coalesce(p_description, ''));
  v_next_due_month date := date_trunc('month', p_next_due_month)::date;
  v_spent_at date;
  v_first_is_current boolean;
  v_expense public.card_expenses%rowtype;
  v_installment_no integer;
  v_due_month date;
  v_is_current boolean;
  i integer;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if v_amount <= 0 then
    raise exception 'Taksit tutarı 0''dan büyük olmalı.';
  end if;

  if v_description = '' then
    raise exception 'Açıklama zorunlu.';
  end if;

  if v_total < 2 or v_total > 36 then
    raise exception 'Toplam taksit 2 ile 36 arasında olmalı.';
  end if;

  if v_paid < 0 or v_paid >= v_total then
    raise exception 'Ödenen taksit toplam taksitten küçük olmalı.';
  end if;

  if p_next_due_month is null then
    raise exception 'Sıradaki taksit ayı zorunlu.';
  end if;

  if v_next_due_month < date_trunc('month', current_date)::date then
    raise exception 'Sıradaki taksit ayı geçmiş olamaz.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Taksit devri sadece kredi kartı için kullanılabilir.';
  end if;

  v_remaining_count := v_total - v_paid;
  v_remaining_amount := round(v_amount * v_remaining_count, 2);
  v_total_amount := round(v_amount * v_total, 2);
  v_spent_at := (v_next_due_month - (v_paid || ' month')::interval)::date;
  v_first_is_current := v_next_due_month = date_trunc('month', current_date)::date;

  insert into public.card_expenses (
    user_id, card_id, spent_at, amount, description, category,
    installment_count, installment_amount, status, posted_at, note
  )
  values (
    v_user_id, p_card_id, v_spent_at, v_total_amount, v_description, v_category,
    v_total, v_amount, 'posted', now(),
    v_paid || '/' || v_total || ' taksiti uygulama öncesinde ödendi.'
  )
  returning * into v_expense;

  -- Önceden ödenmiş taksit satırları (1..v_paid)
  for i in 0..(v_paid - 1) loop
    v_installment_no := i + 1;
    v_due_month := (v_spent_at + (i || ' month')::interval)::date;

    insert into public.card_installments (
      user_id, card_id, card_expense_id, installment_no, installment_count,
      due_month, amount, description, category, status, posted_at, paid_at, note
    )
    values (
      v_user_id, p_card_id, v_expense.id, v_installment_no, v_total,
      v_due_month, v_amount, v_description, v_category,
      'posted', v_due_month, v_due_month,
      'Uygulama öncesinde ödenmiş taksit.'
    );
  end loop;

  -- Kalan taksit satırları (v_paid+1..v_total)
  for i in 0..(v_remaining_count - 1) loop
    v_installment_no := v_paid + i + 1;
    v_due_month := (v_next_due_month + (i || ' month')::interval)::date;
    v_is_current := date_trunc('month', v_due_month) = date_trunc('month', current_date);

    insert into public.card_installments (
      user_id, card_id, card_expense_id, installment_no, installment_count,
      due_month, amount, description, category, status, posted_at, paid_at, note
    )
    values (
      v_user_id, p_card_id, v_expense.id, v_installment_no, v_total,
      v_due_month, v_amount, v_description, v_category,
      case when v_is_current then 'posted' else 'scheduled' end,
      case when v_is_current then now() else null end,
      null,
      'Uygulama öncesinden devreden taksit.'
    );
  end loop;

  update public.cards
  set debt_amount = debt_amount + v_remaining_amount,
      current_period_spending = current_period_spending + case when v_first_is_current then v_amount else 0 end,
      updated_at = now()
  where id = p_card_id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    v_description || ' taksit devri',
    v_remaining_amount,
    'card_expenses',
    v_expense.id,
    v_paid || '/' || v_total || ' taksit ödenmiş; kalan ' || v_remaining_count || ' taksit eklendi.'
  );

  return v_expense;
end;
$$;
