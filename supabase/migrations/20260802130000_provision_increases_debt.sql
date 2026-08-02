-- F (denetim 2026-08-02, Yol A): Provizyon artik toplam borcu (debt_amount) artirir.
-- Kok neden: 20260625 provizyonu borctan ayirmisti ama clamp_card_breakdown hala
-- statement+current+provision <= debt istiyordu => bos/dusuk-borc kartta provizyon
-- clamp ile 0a dusup KAYBOLUYORDU ya da currenti yiyordu. Karar: provizyon toplam
-- borcu artirmali (docs/CARD_DEBT_TRANSITIONS.md ile uyumlu).
-- add_card_expense: provizyonda da debt += amount. post_card_provision: postingde
-- debt EKLEMEZ (borc createte eklendi; post yalniz provision->current tasir).
-- Imza degismedi => grantler korunur. Forward-only (toplu veri migrationi YOK).

CREATE OR REPLACE FUNCTION public.add_card_expense(p_card_id uuid, p_amount numeric, p_description text, p_spent_at date DEFAULT CURRENT_DATE, p_installment_count integer DEFAULT 1, p_category text DEFAULT 'Diğer'::text, p_status text DEFAULT 'posted'::text, p_user_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text)
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
  v_spent_at date := coalesce(p_spent_at, current_date);
  v_status text := case
    when lower(btrim(coalesce(p_status, 'posted'))) = 'provision' then 'provision'
    else 'posted'
  end;
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Diğer');
  v_current_period_amount numeric(14, 2) := 0;
  v_source text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'manual');
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
        if v_due_month <= current_date then
          v_current_period_amount := v_current_period_amount + v_installment_amount;
        end if;
      end loop;
    else
      v_current_period_amount := p_amount;
    end if;
  end if;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + p_amount,  -- F: provizyon da toplam borcu artirir (create'te)
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
    source
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
    case when v_status = 'posted' then now() else null end,
    v_source
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
        case when v_due_month <= current_date then 'posted' else 'scheduled' end,
        case when v_due_month <= current_date then now() else null end
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
      when v_status = 'provision' then 'Kart harcamasi provizyona alindi.'
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcamasi.'
      else 'Pesin kart harcamasi.'
    end
  );

  return v_expense;
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

  if v_expense.installment_count > 1 then
    for v_installment_no in 1..v_expense.installment_count loop
      v_installment_amount := round(v_post_amount / v_expense.installment_count, 2);
      if v_installment_no = v_expense.installment_count then
        v_installment_amount := v_post_amount - (round(v_post_amount / v_expense.installment_count, 2) * (v_expense.installment_count - 1));
      end if;

      v_due_month := (v_expense.spent_at + ((v_installment_no - 1) * interval '1 month'))::date;
      if v_due_month <= current_date then
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
        case when v_due_month <= current_date then 'posted' else 'scheduled' end,
        case when v_due_month <= current_date then now() else null end
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
