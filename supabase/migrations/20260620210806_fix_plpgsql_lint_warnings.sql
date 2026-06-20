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
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutari 0 dan buyuk olmali.';
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
      when v_status = 'provision' then 'Kart harcamasi provizyona alindi.'
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcamasi.'
      else 'Pesin kart harcamasi.'
    end
  );

  return v_expense;
end;
$function$;

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
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutari 0 dan buyuk olmali.';
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

  if v_expense.note ~ '^[0-9]+/[0-9]+ taksiti uygulama oncesinde odendi\.$' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksiti uygulama oncesinde odendi\.$'))[1]::integer
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

create or replace function public.reset_card_data(p_card_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  perform 1
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  -- Once bagli hareket gecmisini sil (kaynak satirlar silinmeden referanslari topla).
  delete from public.transaction_history
  where user_id = v_user_id
    and (
      (source_table = 'card_expenses'
        and source_id in (select id from public.card_expenses where card_id = p_card_id and user_id = v_user_id))
      or (source_table = 'card_installments'
        and source_id in (select id from public.card_installments where card_id = p_card_id and user_id = v_user_id))
      or (source_table = 'card_statement_archives'
        and source_id in (select id from public.card_statement_archives where card_id = p_card_id and user_id = v_user_id))
    );

  delete from public.card_installments
  where card_id = p_card_id and user_id = v_user_id;

  delete from public.card_statement_archives
  where card_id = p_card_id and user_id = v_user_id;

  delete from public.card_expenses
  where card_id = p_card_id and user_id = v_user_id;

  -- Kredi karti borc kirilimini sifirla; banka karti bakiyesine dokunma.
  update public.cards
  set debt_amount = 0,
      statement_debt_amount = 0,
      current_period_spending = 0,
      provision_amount = 0,
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;
end;
$function$;

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
as $function$
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
    v_paid || '/' || v_total || ' taksiti uygulama oncesinde odendi.'
  )
  returning * into v_expense;

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
      'Uygulama oncesinden devreden taksit.'
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
    v_paid || '/' || v_total || ' taksit odenmis; kalan ' || v_remaining_count || ' taksit eklendi.'
  );

  return v_expense;
end;
$function$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop policy if exists "net_worth_snapshots_select" on public.net_worth_snapshots;
create policy "net_worth_snapshots_select"
on public.net_worth_snapshots
for select
using ((select auth.uid()) = user_id);

drop policy if exists "net_worth_snapshots_insert" on public.net_worth_snapshots;
create policy "net_worth_snapshots_insert"
on public.net_worth_snapshots
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "net_worth_snapshots_update" on public.net_worth_snapshots;
create policy "net_worth_snapshots_update"
on public.net_worth_snapshots
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "net_worth_snapshots_delete" on public.net_worth_snapshots;
create policy "net_worth_snapshots_delete"
on public.net_worth_snapshots
for delete
using ((select auth.uid()) = user_id);
