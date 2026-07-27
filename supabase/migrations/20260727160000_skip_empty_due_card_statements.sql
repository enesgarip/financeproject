-- Toplu ekstre bakımı, kartta dönem içi toplam görünse bile kesim sınırına
-- kadar ekstreye girecek tutar olmayabilir. Bu normal durum tek-kart RPC'sinde
-- açıklayıcı bir istisna olarak kalır; otomatik bakımda ise diğer kartların
-- kesilmesini engellemeden atlanır.

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
    raise exception 'Oturum bulunamadı.';
  end if;

  for v_card in
    select cards.id, cards.statement_day
    from public.cards
    where cards.user_id = v_user_id
      and cards.card_type = 'kredi_karti'
      and cards.current_period_spending > 0
      and cards.statement_day is not null
  loop
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
      begin
        perform public.cut_card_statement(v_card.id);
        v_count := v_count + 1;
      exception
        when others then
          if sqlstate = 'P0001'
            and sqlerrm = 'Dönem içi harcama olmadığı için kesilecek ekstre yok.'
          then
            null;
          else
            raise;
          end if;
      end;
    end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.cut_due_card_statements() to authenticated;
revoke execute on function public.cut_due_card_statements() from public;
revoke execute on function public.cut_due_card_statements() from anon;
