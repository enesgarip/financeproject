-- Provizyonlar import sıfırlamasında korunur.
-- Provizyon = kesinleşmemiş SMS bildirimi; ekstrede yer almaz, kullanıcı
-- kesinleştirene kadar provision_amount kovasında kalır.
-- Eski davranış provision_amount'u sıfırlıyor ve provizyon expense'lerini
-- siliyordu — bu dönem dışı provizyon verisini yok ediyordu.

create or replace function public.reset_card_import_data(
  p_card_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_archive_ids uuid[] := array[]::uuid[];
  v_expense_ids uuid[] := array[]::uuid[];
  v_installment_ids uuid[] := array[]::uuid[];
  v_provision_amount numeric;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  perform 1
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  select coalesce(array_agg(id), array[]::uuid[])
  into v_archive_ids
  from public.card_statement_archives
  where card_id = p_card_id
    and user_id = v_user_id
    and coalesce(status, 'open') <> 'paid';

  -- Provizyonları hariç tut: status = 'provision' olanlar silinmez.
  select coalesce(array_agg(id), array[]::uuid[])
  into v_expense_ids
  from public.card_expenses
  where card_id = p_card_id
    and user_id = v_user_id
    and status <> 'provision'
    and (
      statement_archive_id is null
      or statement_archive_id = any(v_archive_ids)
    );

  select coalesce(array_agg(id), array[]::uuid[])
  into v_installment_ids
  from public.card_installments
  where card_id = p_card_id
    and user_id = v_user_id
    and (
      statement_archive_id is null
      or statement_archive_id = any(v_archive_ids)
      or card_expense_id = any(v_expense_ids)
    );

  delete from public.transaction_history
  where user_id = v_user_id
    and (
      (source_table = 'card_expenses' and source_id = any(v_expense_ids))
      or (source_table = 'card_installments' and source_id = any(v_installment_ids))
      or (source_table = 'card_statement_archives' and source_id = any(v_archive_ids))
    );

  perform set_config('app.card_import_reset_user_id', v_user_id::text, true);
  perform set_config('app.card_import_reset_card_id', p_card_id::text, true);

  delete from public.card_installments
  where id = any(v_installment_ids)
    and user_id = v_user_id;

  delete from public.card_expenses
  where id = any(v_expense_ids)
    and user_id = v_user_id;

  delete from public.card_statement_archives
  where id = any(v_archive_ids)
    and user_id = v_user_id;

  perform set_config('app.card_import_reset_card_id', '', true);
  perform set_config('app.card_import_reset_user_id', '', true);

  -- Mevcut provizyon tutarını oku — sıfırlama sonrası borç = yalnız provizyonlar.
  select coalesce(provision_amount, 0)
  into v_provision_amount
  from public.cards
  where id = p_card_id
    and user_id = v_user_id;

  update public.cards
  set debt_amount = v_provision_amount,
      statement_debt_amount = 0,
      current_period_spending = 0,
      -- provision_amount olduğu gibi kalır
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;
end;
$$;
