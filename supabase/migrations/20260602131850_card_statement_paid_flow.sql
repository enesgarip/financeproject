alter table public.card_statement_archives
add column if not exists period_year integer,
add column if not exists period_month integer,
add column if not exists status text not null default 'open',
add column if not exists paid_at timestamptz,
add column if not exists payment_source_card_id uuid references public.cards(id) on delete set null;

update public.card_statement_archives
set period_year = extract(year from statement_date)::integer,
    period_month = extract(month from statement_date)::integer
where period_year is null
   or period_month is null;

alter table public.card_statement_archives
alter column period_year set not null,
alter column period_month set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'card_statement_archives_status_check'
      and conrelid = 'public.card_statement_archives'::regclass
  ) then
    alter table public.card_statement_archives
    add constraint card_statement_archives_status_check
    check (status in ('open', 'paid'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'card_statement_archives_period_check'
      and conrelid = 'public.card_statement_archives'::regclass
  ) then
    alter table public.card_statement_archives
    add constraint card_statement_archives_period_check
    check (period_year between 2000 and 2100 and period_month between 1 and 12);
  end if;
end $$;

alter table public.card_installments
add column if not exists statement_archive_id uuid references public.card_statement_archives(id) on delete set null;

alter table public.card_expenses
add column if not exists statement_archive_id uuid references public.card_statement_archives(id) on delete set null;

create index if not exists card_statement_archives_user_status_due_idx
on public.card_statement_archives(user_id, status, due_date);

create index if not exists card_statement_archives_card_period_idx
on public.card_statement_archives(card_id, period_year, period_month);

create index if not exists card_installments_statement_archive_idx
on public.card_installments(statement_archive_id);

create index if not exists card_expenses_statement_archive_idx
on public.card_expenses(statement_archive_id);

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
  v_period_year integer := extract(year from current_date)::integer;
  v_period_month integer := extract(month from current_date)::integer;
  v_next_period_start date := (date_trunc('month', current_date)::date + interval '1 month')::date;
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

  v_statement_amount := v_card.current_period_spending;

  if v_card.due_day is not null then
    v_due_month_start := date_trunc('month', current_date)::date;
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
    current_date,
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
    and spent_at <= current_date;

  update public.card_installments
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month <= date_trunc('month', current_date)::date;

  select coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_installments
  where user_id = v_user_id
    and card_id = v_card.id
    and due_month = v_next_period_start
    and status = 'scheduled';

  update public.card_installments
  set status = 'posted',
      posted_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and due_month = v_next_period_start
    and status = 'scheduled';

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
    'Donem borcu ekstreye aktarildi. Kredi karti taksitleri ayri borc olarak eklenmedi.'
  );

  return v_archive;
end;
$$;

grant execute on function public.cut_card_statement(uuid) to authenticated;

create or replace function public.cut_due_card_statements()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card record;
  v_count integer := 0;
  v_today_day integer := extract(day from current_date)::integer;
  v_month_last_day integer := extract(day from (date_trunc('month', current_date)::date + interval '1 month - 1 day'))::integer;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  for v_card in
    select id, statement_day
    from public.cards
    where user_id = v_user_id
      and card_type = 'kredi_karti'
      and current_period_spending > 0
      and statement_day is not null
      and least(statement_day, v_month_last_day) <= v_today_day
  loop
    perform public.cut_card_statement(v_card.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.cut_due_card_statements() to authenticated;

create or replace function public.pay_card_statement(
  p_statement_id uuid,
  p_source_card_id uuid
)
returns public.card_statement_archives
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_statement public.card_statement_archives%rowtype;
  v_paid_statement public.card_statement_archives%rowtype;
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_payment_amount numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_statement
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Ekstre bulunamadi.';
  end if;

  if v_statement.status <> 'open' then
    raise exception 'Bu ekstre zaten kapali.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_statement.card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstre odemesi sadece kredi karti icin kullanilabilir.';
  end if;

  select *
  into v_source
  from public.cards
  where id = p_source_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kaynak hesap bulunamadi.';
  end if;

  if v_source.card_type <> 'banka_karti' then
    raise exception 'Kaynak hesap banka karti olmali.';
  end if;

  v_payment_amount := least(
    greatest(0, v_statement.statement_debt_amount),
    greatest(0, v_card.statement_debt_amount),
    greatest(0, v_card.debt_amount)
  );

  if v_source.current_balance < v_payment_amount then
    raise exception 'Kaynak hesap bakiyesi yetersiz.';
  end if;

  update public.cards
  set current_balance = current_balance - v_payment_amount,
      updated_at = now()
  where id = v_source.id;

  update public.cards
  set debt_amount = greatest(0, debt_amount - v_payment_amount),
      statement_debt_amount = greatest(0, statement_debt_amount - v_payment_amount),
      updated_at = now()
  where id = v_card.id;

  update public.card_installments
  set status = 'paid',
      paid_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and statement_archive_id = v_statement.id
    and status <> 'paid';

  update public.card_statement_archives
  set status = 'paid',
      paid_at = now(),
      payment_source_card_id = v_source.id,
      updated_at = now()
  where id = v_statement.id
  returning * into v_paid_statement;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_card.card_name || ' ekstresi odendi',
    v_payment_amount,
    'card_statement_archives',
    v_statement.id,
    v_source.card_name || ' hesabindan odendi. Bagli kart taksitleri otomatik kapatildi.'
  );

  return v_paid_statement;
end;
$$;

grant execute on function public.pay_card_statement(uuid, uuid) to authenticated;
