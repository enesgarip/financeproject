-- Kesilmiş açık ekstre kapsamındaki provizyon elle yeni döneme taşınamaz.
begin;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_expense uuid;
  v_blocked boolean := false;
begin
  insert into public.cards (
    user_id, bank_name, card_name, card_type, credit_limit,
    debt_amount, statement_debt_amount, current_period_spending, provision_amount,
    statement_day, due_day, current_balance
  ) values (
    v_user, 'Test Bank', 'Kesim Sonrasi Provizyon', 'kredi_karti', 50000,
    0, 0, 0, 0, 15, 25, 0
  ) returning id into v_card;

  select id into v_expense
  from public.add_card_expense(
    v_card, 750, 'Ekstrede kalan provizyon', date '2026-09-15',
    1, 'Diğer', 'provision', v_user, 'manual'
  );

  insert into public.card_statement_archives (
    user_id, card_id, statement_date, due_date, period_year, period_month,
    statement_debt_amount, status
  ) values (
    v_user, v_card, date '2026-09-15', date '2026-09-25', 2026, 9,
    0, 'open'
  );

  begin
    perform public.post_card_provision(v_expense);
  exception when others then
    if sqlerrm like 'Bu provizyon kesilmis ekstre doneminde.%' then
      v_blocked := true;
    else
      raise;
    end if;
  end;

  if not v_blocked then
    raise exception 'Kesim kapsamindaki provizyon post edilmemeliydi.';
  end if;

  if (select status from public.card_expenses where id = v_expense) <> 'provision' then
    raise exception 'Engellenen provizyon degismeden kalmaliydi.';
  end if;

  raise notice 'GECTI post_cut_provision_guard: kesim kapsamindaki provizyon engellendi.';
end $$;

rollback;
