-- Card installments now keep the transaction day instead of normalizing every
-- row to the first day of the month. Scheduled rows are posted into
-- current_period_spending only after their own due date passes.

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
    set debt_amount = debt_amount + case when v_status = 'posted' then p_amount else 0 end,
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
$function$;

grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid) to authenticated;
grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid) to service_role;

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

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Harcama bulunamadi.';
  end if;

  if v_expense.status <> 'posted' then
    raise exception 'Sadece kesinlesmis harcamalar duzenlenebilir.';
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

  v_installment_count := greatest(1, least(coalesce(p_installment_count, v_expense.installment_count), 36));
  v_spent_at := coalesce(p_spent_at, v_expense.spent_at);
  v_category := coalesce(nullif(btrim(coalesce(p_category, '')), ''), v_expense.category);

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

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

grant execute on function public.update_card_expense(uuid, numeric, text, date, integer, text, text) to authenticated;

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
    set debt_amount = debt_amount + v_post_amount,
        provision_amount = greatest(0, provision_amount - v_post_amount),
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
$$;

grant execute on function public.post_card_provision(uuid, numeric) to authenticated;

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
  v_next_due_month date := p_next_due_month;
  v_spent_at date;
  v_current_period_amount numeric(14, 2) := 0;
  v_expense public.card_expenses%rowtype;
  v_installment_no integer;
  v_due_month date;
  v_is_current boolean;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if v_amount <= 0 then
    raise exception 'Taksit tutari 0''dan buyuk olmali.';
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
    raise exception 'Siradaki taksit tarihi zorunlu.';
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

  insert into public.card_expenses (
    user_id, card_id, spent_at, amount, description, category,
    installment_count, installment_amount, status, posted_at, note
  )
  values (
    v_user_id, p_card_id, v_spent_at, v_total_amount, v_description, v_category,
    v_total, v_amount, 'posted', now(),
    v_paid || '/' || v_total || ' taksiti uygulama oncesinde odendi.'
  )
  returning * into v_expense;

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
      'Uygulama oncesinde odenmis taksit.'
    );
  end loop;

  for i in 0..(v_remaining_count - 1) loop
    v_installment_no := v_paid + i + 1;
    v_due_month := (v_next_due_month + (i || ' month')::interval)::date;
    v_is_current := v_due_month <= current_date;
    if v_is_current then
      v_current_period_amount := v_current_period_amount + v_amount;
    end if;

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
      'Uygulama oncesinden devreden taksit.'
    );
  end loop;

  update public.cards
  set debt_amount = debt_amount + v_remaining_amount,
      current_period_spending = current_period_spending + v_current_period_amount,
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
    v_paid || '/' || v_total || ' taksit odenmis; kalan ' || v_remaining_count || ' taksit eklendi.'
  );

  return v_expense;
end;
$$;

grant execute on function public.record_card_installment_carryover(uuid, text, numeric, integer, integer, date, text) to authenticated;

create or replace function public.post_due_card_installments()
returns integer
language plpgsql
set search_path = ''
as $$
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
      and due_month <= current_date
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
        and due_month <= current_date
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
$$;

revoke execute on function public.post_due_card_installments() from public;
grant execute on function public.post_due_card_installments() to authenticated;

create or replace function public.cut_card_statement(
  p_card_id uuid
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
    raise exception 'Oturum bulunamadi.';
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

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstre sadece kredi karti icin kesilebilir.';
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
    raise exception 'Donem ici harcama olmadigi icin kesilecek ekstre yok.';
  end if;

  select coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_expenses
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
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
    raise exception 'Donem ici harcama olmadigi icin kesilecek ekstre yok.';
  end if;

  if v_card.due_day is not null then
    v_due_month_start := date_trunc('month', v_boundary)::date;
    if v_card.statement_day is not null and v_card.due_day <= v_card.statement_day then
      v_due_month_start := (v_due_month_start + interval '1 month')::date;
    end if;

    v_due_day := least(v_card.due_day, extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer);
    v_due_date := v_due_month_start + (v_due_day - 1);
  end if;

  insert into public.card_statement_archives (
    user_id,
    card_id,
    period_year,
    period_month,
    statement_date,
    due_date,
    statement_debt_amount,
    current_period_spending,
    total_debt_amount,
    status,
    note
  )
  values (
    v_user_id,
    v_card.id,
    v_period_year,
    v_period_month,
    v_boundary,
    v_due_date,
    v_statement_amount,
    v_statement_amount,
    v_card.debt_amount,
    'open',
    v_card.card_name || ' ekstresi kesildi.'
  )
  returning * into v_archive;

  update public.card_expenses
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
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

  update public.cards
  set statement_debt_amount = statement_debt_amount + v_statement_amount,
      current_period_spending = v_next_period_spending,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    v_card.card_name || ' ekstresi kesildi',
    v_statement_amount,
    'card_statement_archives',
    v_archive.id,
    'Donem borcu ekstreye aktarildi. Vadesi gelmemis kredi karti taksitleri donem icine alinmadi.'
  );

  return v_archive;
end;
$$;

grant execute on function public.cut_card_statement(uuid) to authenticated;

create or replace function public.run_scheduled_card_maintenance(
  p_provision_stale_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
        and spent_at <= (current_date - p_provision_stale_days)
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
$$;

revoke execute on function public.run_scheduled_card_maintenance(integer) from public;

-- Existing rows created by earlier RPCs used the first of the month. Move
-- unstatemented linked rows to the actual transaction day, then repair visible
-- current-period state according to the new due-date rule.
update public.card_installments as installment
set due_month = (expense.spent_at + ((installment.installment_no - 1) * interval '1 month'))::date,
    updated_at = now()
from public.card_expenses as expense
where installment.card_expense_id = expense.id
  and installment.statement_archive_id is null
  and installment.status <> 'paid'
  and expense.installment_count > 1
  and installment.due_month is distinct from (expense.spent_at + ((installment.installment_no - 1) * interval '1 month'))::date;

with premature as (
  select card_id, sum(amount) as amount
  from public.card_installments
  where statement_archive_id is null
    and status = 'posted'
    and due_month > current_date
  group by card_id
)
update public.cards as card
set current_period_spending = greatest(0, card.current_period_spending - premature.amount),
    updated_at = now()
from premature
where card.id = premature.card_id;

update public.card_installments
set status = 'scheduled',
    posted_at = null,
    updated_at = now()
where statement_archive_id is null
  and status = 'posted'
  and due_month > current_date;

with due as (
  select card_id, sum(amount) as amount
  from public.card_installments
  where statement_archive_id is null
    and status = 'scheduled'
    and due_month <= current_date
  group by card_id
)
update public.cards as card
set current_period_spending = current_period_spending + due.amount,
    updated_at = now()
from due
where card.id = due.card_id
  and card.card_type = 'kredi_karti';

update public.card_installments
set status = 'posted',
    posted_at = now(),
    updated_at = now()
where statement_archive_id is null
  and status = 'scheduled'
  and due_month <= current_date;
