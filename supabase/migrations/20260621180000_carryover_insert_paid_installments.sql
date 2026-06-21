-- Taksit devri RPC'sini güncelle: önceden ödenmiş taksitleri de 'posted' + paid_at
-- ile oluştur. Böylece DataHealth eksik taksit uyarısı vermez ve taksit planı
-- tüm geçmişi yansıtır.

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
    raise exception 'Oturum bulunamadi.';
  end if;

  if v_amount <= 0 then
    raise exception 'Taksit tutari 0 dan buyuk olmali.';
  end if;

  if v_description = '' then
    raise exception 'Aciklama zorunlu.';
  end if;

  if v_total < 2 or v_total > 36 then
    raise exception 'Toplam taksit 2 ile 36 arasinda olmali.';
  end if;

  if v_paid < 0 or v_paid >= v_total then
    raise exception 'Odenen taksit toplam taksitten kucuk olmali.';
  end if;

  if p_next_due_month is null then
    raise exception 'Siradaki taksit ayi zorunlu.';
  end if;

  if v_next_due_month < date_trunc('month', current_date)::date then
    raise exception 'Siradaki taksit ayi gecmis olamaz.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Taksit devri sadece kredi karti icin kullanilabilir.';
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
    v_paid || '/' || v_total || ' taksit ödenmis; kalan ' || v_remaining_count || ' taksit eklendi.'
  );

  return v_expense;
end;
$$;
