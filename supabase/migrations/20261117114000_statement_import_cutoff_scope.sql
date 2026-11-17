-- PDF kesimi uygulamanın otomatik kesiminden erken olabilir. Sonraki günün
-- açık hareketleri, yanlış arşiv bağı olsa bile kendi kimliğiyle korunur.

do $migration$
declare
  v_definition text := pg_get_functiondef('private.guard_current_settlement_allocation()'::regprocedure);
  v_anchor text := $anchor$    if old.statement_archive_id is not null
       or new.statement_archive_id is null$anchor$;
begin
  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Ekstre bağlantısı korumasının değiştirme noktası bulunamadı.';
  end if;

  -- Yalnız atomik PDF aktarımının sahip olduğu, ödemesiz geçici arşiv bağı
  -- kaldırılabilir. Hareketin öteki alanları aynı kalmalı.
  execute replace(v_definition, v_anchor, $guard$    if old.statement_archive_id is not null
       and new.statement_archive_id is null
       and v_user_id = old.user_id
       and v_import_reset_user_id = v_user_id::text
       and v_import_reset_card_id = old.card_id::text
       and old.current_settlement_id is null
       and coalesce((to_jsonb(old) ->> 'spent_at')::date, (to_jsonb(old) ->> 'due_month')::date)
         > nullif(current_setting('app.card_statement_import_cutoff', true), '')::date
       and (to_jsonb(old) - 'statement_archive_id' - 'updated_at')
         = (to_jsonb(new) - 'statement_archive_id' - 'updated_at')
       and exists (
         select 1 from public.card_statement_archives archive
         where archive.id = old.statement_archive_id
           and archive.user_id = old.user_id
           and archive.card_id = old.card_id
           and coalesce(archive.status, 'open') = 'open'
           and archive.statement_date > nullif(current_setting('app.card_statement_import_cutoff', true), '')::date
           and archive.reconciled_bank_amount is null
           and not exists (
             select 1 from public.card_statement_payments payment where payment.statement_archive_id = archive.id
           )
       ) then
      return new;
    end if;

    if old.statement_archive_id is not null
       or new.statement_archive_id is null$guard$);
end $migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef('public.replace_card_statement_import(uuid,date,date,numeric,jsonb)'::regprocedure);
  v_start integer := strpos(v_definition, '  -- Bu kartın açık ekstresi yeniden üretilebilir;');
  v_end integer := strpos(v_definition, '  delete from public.transaction_history');
begin
  if v_start = 0 or v_end <= v_start then
    raise exception 'Ekstre aktarım kapsamının değiştirme noktası bulunamadı.';
  end if;

  execute overlay(v_definition placing $scope$  -- Banka tarafından doğrulanmış daha yeni ekstre veya kaydedilmiş kısmi
  -- ödeme, geçici otomatik arşiv gibi silinip yeniden kurulamaz.
  if exists (
    select 1 from public.card_statement_archives archive
    where archive.card_id = p_card_id and archive.user_id = v_user_id
      and coalesce(archive.status, 'open') = 'open'
      and archive.statement_date > p_statement_date and archive.reconciled_bank_amount is not null
  ) then
    raise exception 'Bu kartta PDF kesiminden daha yeni, banka tutarı doğrulanmış bir ekstre var.';
  end if;

  select coalesce(array_agg(id), array[]::uuid[])
  into v_archive_ids
  from public.card_statement_archives
  where card_id = p_card_id and user_id = v_user_id and coalesce(status, 'open') = 'open';

  if exists (
    select 1 from public.card_statement_payments payment
    where payment.user_id = v_user_id and payment.card_id = p_card_id
      and payment.statement_archive_id = any(v_archive_ids)
  ) then
    raise exception 'Açık ekstreye ödeme kaydedilmiş. Ödeme geçmişi korunarak bu PDF yeniden aktarılamaz.';
  end if;

  -- Tek çekimin tarihi kendi satırından, taksitli planın kapsamı ise açık
  -- çocuklarının tarihlerinden belirlenir. Arşiv üyeliği tarihi geçersiz kılmaz.
  select coalesce(array_agg(distinct expense_id), array[]::uuid[])
  into v_rebuild_expense_ids
  from (
    select expense.id as expense_id
    from public.card_expenses expense
    where expense.card_id = p_card_id and expense.user_id = v_user_id
      and expense.spent_at <= p_statement_date and expense.current_settlement_id is null
      and (expense.statement_archive_id is null or expense.statement_archive_id = any(v_archive_ids))
      and not exists (select 1 from public.card_installments child where child.card_expense_id = expense.id)

    union

    select installment.card_expense_id
    from public.card_installments installment
    where installment.card_id = p_card_id and installment.user_id = v_user_id
      and installment.card_expense_id is not null and installment.current_settlement_id is null
      and installment.due_month <= p_statement_date
      and (installment.statement_archive_id is null or installment.statement_archive_id = any(v_archive_ids))
  ) scope;

  -- PDF aynı planı yeniden oynatacaksa sonradan kesinleşmiş bir taksiti
  -- geçici arşivden tahminle silmek veya ikinci kez kurmak yerine durdur.
  if exists (
    select 1 from public.card_installments installment
    where installment.card_id = p_card_id and installment.user_id = v_user_id
      and installment.card_expense_id = any(v_rebuild_expense_ids)
      and installment.due_month > p_statement_date and installment.status = 'posted'
      and installment.current_settlement_id is null
      and installment.statement_archive_id = any(v_archive_ids)
  ) then
    raise exception 'Ekstre kapsamındaki bir planın kesim sonrasında kesinleşmiş taksiti var. Mevcut planı ve banka ekstresini karşılaştır.';
  end if;

  -- Ödenmiş veya dönem içinde kapanmış çocuk taşıyan planın parent'ı kalır.
  select coalesce(array_agg(expense.id), array[]::uuid[])
  into v_delete_expense_ids
  from public.card_expenses expense
  where expense.id = any(v_rebuild_expense_ids)
    and expense.card_id = p_card_id and expense.user_id = v_user_id
    and expense.spent_at <= p_statement_date and expense.current_settlement_id is null
    and (expense.statement_archive_id is null or expense.statement_archive_id = any(v_archive_ids))
    and not exists (
      select 1 from public.card_installments child
      left join public.card_statement_archives archive on archive.id = child.statement_archive_id
      where child.card_expense_id = expense.id
        and (child.current_settlement_id is not null or child.status = 'paid'
          or (child.statement_archive_id is not null and coalesce(archive.status, 'open') = 'paid'))
    );

  select coalesce(array_agg(installment.id), array[]::uuid[])
  into v_delete_installment_ids
  from public.card_installments installment
  where installment.card_id = p_card_id and installment.user_id = v_user_id
    and installment.current_settlement_id is null and installment.status <> 'paid'
    and (installment.statement_archive_id is null or installment.statement_archive_id = any(v_archive_ids))
    and (installment.card_expense_id = any(v_rebuild_expense_ids)
      or (installment.card_expense_id is null and installment.due_month <= p_statement_date));

  -- Eski otomatik kesim yeni günün satırlarını yakaladıysa sadece bağını çöz.
  -- FK arşivi kaldırmadan önce hareketler ayrılır. Kimlik ve geçmiş kalır.
  perform set_config('app.card_import_reset_user_id', v_user_id::text, true);
  perform set_config('app.card_import_reset_card_id', p_card_id::text, true);
  perform set_config('app.card_statement_import_cutoff', p_statement_date::text, true);

  update public.card_expenses set statement_archive_id = null, updated_at = now()
  where card_id = p_card_id and user_id = v_user_id
    and statement_archive_id = any(v_archive_ids) and spent_at > p_statement_date;

  update public.card_installments set statement_archive_id = null, updated_at = now()
  where card_id = p_card_id and user_id = v_user_id
    and statement_archive_id = any(v_archive_ids) and due_month > p_statement_date;

  perform set_config('app.card_statement_import_cutoff', '', true);
  perform set_config('app.card_import_reset_card_id', '', true);
  perform set_config('app.card_import_reset_user_id', '', true);

$scope$ from v_start for v_end - v_start);
end $migration$;
