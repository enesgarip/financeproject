-- Statement cutting: cut the day AFTER the statement day, like banks.
--
-- Previously cut_due_card_statements fired when `statement_day <= today`, i.e. ON
-- the statement day itself. That pushed any spending made on the statement day into
-- the NEXT period. Banks include the statement-day spending in that day's statement
-- and process the cut once the day is over. This migration moves both the trigger
-- and the per-statement bookkeeping to a single shared "boundary" definition:
--
--   boundary = the most recent statement-day (clamped to month length) that has
--              FULLY passed (current_date > boundary).
--
-- The cut runs the day after the boundary (the daily 00:05 pg_cron job catches it).
-- The archive period (period_year/month), statement_date and due_date are derived
-- from the boundary instead of current_date, so month-end cards (statement_day
-- 29/30/31) are labelled with the correct period even though the cut runs next month.
--
-- Signatures are unchanged, so existing grants and Database type definitions stay
-- valid. Both functions use the identical boundary computation to stay consistent.

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
  v_next_period_start date;
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

  -- Boundary = most recent statement day (clamped to month length) that has fully
  -- passed. Cards without a statement day fall back to the legacy current_date.
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
  v_next_period_start := (date_trunc('month', v_boundary) + interval '1 month')::date;

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

  v_statement_amount := v_card.current_period_spending;

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
    and spent_at <= current_date;

  update public.card_installments
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month <= date_trunc('month', v_boundary)::date;

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
  v_boundary date;
  v_this_boundary date;
  v_prev_month_start date;
  v_period_year integer;
  v_period_month integer;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  for v_card in
    select cards.id, cards.statement_day
    from public.cards
    where cards.user_id = v_user_id
      and cards.card_type = 'kredi_karti'
      and cards.current_period_spending > 0
      and cards.statement_day is not null
  loop
    -- Same boundary definition as cut_card_statement: only cut once the statement
    -- day is fully over (current_date > boundary), so that day's own spending is
    -- already counted before the snapshot.
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

    v_period_year := extract(year from v_boundary)::integer;
    v_period_month := extract(month from v_boundary)::integer;

    if not exists (
      select 1
      from public.card_statement_archives
      where card_statement_archives.user_id = v_user_id
        and card_statement_archives.card_id = v_card.id
        and card_statement_archives.period_year = v_period_year
        and card_statement_archives.period_month = v_period_month
    ) then
      perform public.cut_card_statement(v_card.id);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.cut_due_card_statements() to authenticated;
