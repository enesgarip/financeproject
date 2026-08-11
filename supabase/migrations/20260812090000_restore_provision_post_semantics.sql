-- Denetim 2026-08-12 K3: post_card_provision regresyonunun geri alinmasi.
--
-- 20260811100000 (partial_provision_keeps_context) fonksiyonu "20260528062250
-- ile ayni" diyerek ESKI govdeden turetti ve arada yapilan iki davranis
-- iyilestirmesini sessizce kaybetti:
--
--   1) 20260706130000: taksit due_month'u ISLEM GUNUNDEN turetilir
--      (spent_at + n ay), ay basina normalize edilmez. Regresyon ay basina
--      dondu; kesim siniri uyeligi (due_month <= boundary) kayabiliyordu.
--   2) 20260706130000 + 20260802130000: vadesi gecmis TUM taksitler 'posted'
--      dogar ve current_period_spending gecmis taksitlerin TOPLAMI kadar artar.
--      Regresyon yalnizca 1. taksiti posted yapip current'i yalniz ilk taksit
--      kadar artiriyordu.
--
-- Bu migration 20260802130000'deki dogru govdeyi geri getirir; 20260811100000'in
-- TEK gercek katkisi olan context_id kopyalamasini korur. Sondaki onarim blogu
-- (20260706130000'dekiyle ayni, idempotent) regresyon penceresinde ay-basi
-- tarihiyle dogan taksitleri isleme gunune tasir ve posted/scheduled durumunu
-- vade kuralina gore duzeltir.

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

  -- Vadesi gecmis taksitlerin TOPLAMI donem icine girer (yalniz ilki degil);
  -- vade isleme gununden turetilir (ay basi degil).
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
      note,
      context_id
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
      v_expense.note,
      v_expense.context_id
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

-- ── Onarim (idempotent; 20260706130000'deki blokla ayni) ────────────────────
-- Regresyon penceresinde (2026-08-11 sonrasi) kesinlesen provizyonlarin
-- taksitleri ay basina yazildi ve yalniz 1. taksit posted oldu. Asagisi tum
-- kullanicilarda tarih modelini isleme gunune tasir, erken posted'lari geri
-- alir ve vadesi gecmis scheduled'lari donem icine isler.

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
