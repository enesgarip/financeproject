-- Banka modeli: taksit tek tek ödenmez; ekstre ödenir.
-- Devreden plan yalnız henüz ekstreleşmemiş cari/gelecek taksitleri üretir.
-- Ekstre ödemesi arşiv tutarını kaynak kabul eder ve taksit planına dokunmaz.

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
    raise exception 'Geçmiş taksit sayısı toplam taksitten küçük olmalı.';
  end if;

  if v_next_due_month is null then
    raise exception 'Sıradaki taksit tarihi zorunlu.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Taksit planı için kredi kartı bulunamadı.';
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
    v_paid || '/' || v_total || ' taksit ekstre öncesinde tamamlandı; yalnız açık plan tutulur.'
  )
  returning * into v_expense;

  -- Geçmiş taksitler sentetik satır olarak tekrar yaratılmaz. PDF'deki cari
  -- taksit ve ondan sonraki taksitler açık planın tamamıdır.
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
      'Ekstre/PDF kaynaklı açık taksit planı.'
    );
  end loop;

  update public.cards
  set debt_amount = debt_amount + v_remaining_amount,
      current_period_spending = current_period_spending + v_current_period_amount,
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;

  insert into public.transaction_history (
    user_id, type, title, amount, source_table, source_id, note
  )
  values (
    v_user_id,
    'card',
    v_description || ' açık taksit planı',
    v_remaining_amount,
    'card_expenses',
    v_expense.id,
    (v_paid + 1) || '/' || v_total || ' taksitten başlayarak ' || v_remaining_count || ' açık taksit oluşturuldu.'
  );

  return v_expense;
end;
$$;

revoke execute on function public.record_card_installment_carryover(uuid, text, numeric, integer, integer, date, text) from public;
revoke execute on function public.record_card_installment_carryover(uuid, text, numeric, integer, integer, date, text) from anon;
grant execute on function public.record_card_installment_carryover(uuid, text, numeric, integer, integer, date, text) to authenticated;

create or replace function public.pay_card_statement(
  p_statement_id uuid,
  p_source_card_id uuid
)
returns public.card_statement_archives
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_initial_card_id uuid;
  v_statement public.card_statement_archives%rowtype;
  v_paid_statement public.card_statement_archives%rowtype;
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_payment_amount numeric(14, 2);
  v_remaining_statement_debt numeric(14, 2);
  v_minimum_visible_debt numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select card_id
  into v_initial_card_id
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Ekstre bulunamadı.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_initial_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstresi ödenecek kredi kartı bulunamadı.';
  end if;

  select *
  into v_statement
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id
    and card_id = v_card.id
  for update;

  if not found then
    raise exception 'Ekstre bulunamadı veya kartı değişti; yeniden deneyin.';
  end if;

  if v_statement.status <> 'open' then
    raise exception 'Bu ekstre zaten kapalı.';
  end if;

  v_payment_amount := round(greatest(0, v_statement.statement_debt_amount), 2);
  if v_payment_amount <= 0 then
    raise exception 'Ekstre tutarı 0 olduğu için ödeme yapılamaz.';
  end if;

  -- Kaynak hesap hareketi ekstre arşivindeki banka tutarıyla yapılır. Kartın
  -- geçici aggregate drift'i ödemeyi engellemez.
  v_source := private.debit_bank_account(p_source_card_id, v_payment_amount);

  perform set_config('app.card_statement_payment_user_id', v_user_id::text, true);
  perform set_config('app.card_statement_payment_id', v_statement.id::text, true);

  update public.card_statement_archives
  set status = 'paid',
      paid_at = now(),
      payment_source_card_id = v_source.id,
      updated_at = now()
  where id = v_statement.id
  returning * into v_paid_statement;

  perform set_config('app.card_statement_payment_id', '', true);
  perform set_config('app.card_statement_payment_user_id', '', true);

  select round(coalesce(sum(statement_debt_amount), 0), 2)
  into v_remaining_statement_debt
  from public.card_statement_archives
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'open';

  v_minimum_visible_debt := round(
    v_remaining_statement_debt
      + greatest(0, v_card.current_period_spending)
      + greatest(0, v_card.provision_amount),
    2
  );

  update public.cards
  set debt_amount = greatest(
        0,
        round(v_card.debt_amount - v_payment_amount, 2),
        v_minimum_visible_debt
      ),
      statement_debt_amount = v_remaining_statement_debt,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (
    user_id, type, title, amount, source_table, source_id, note
  )
  values (
    v_user_id,
    'payment',
    v_card.card_name || ' ekstresi ödendi',
    v_payment_amount,
    'card_statement_archives',
    v_statement.id,
    v_source.card_name || ' hesabından ödendi. Taksit planı değiştirilmedi.'
  );

  return v_paid_statement;
end;
$$;

revoke execute on function public.pay_card_statement(uuid, uuid) from public;
revoke execute on function public.pay_card_statement(uuid, uuid) from anon;
grant execute on function public.pay_card_statement(uuid, uuid) to authenticated;
