-- SI-07: Tarihsel parent tutarı değişmeden kalırken PDF açık taksitleri kaynak gerçek olur.
-- Parent tutar farkı artık importu engellemez; yalnız taksit adedi çakışması bloklanır.
-- Ödenmiş ekstre/current-settlement kanıtları ile PDF tarihinden sonraki
-- hareketler korunur; yeniden kurulabilir kapsam tek transaction'da silinir,
-- PDF aksiyonları yeniden oynatılır ve ekstre banka toplamına kilitlenir.

create or replace function public.replace_card_statement_import(
  p_card_id uuid,
  p_statement_date date,
  p_due_date date,
  p_bank_amount numeric,
  p_actions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_action jsonb;
  v_kind text;
  v_preserved_expense public.card_expenses%rowtype;
  v_archive public.card_statement_archives%rowtype;
  v_archive_ids uuid[] := array[]::uuid[];
  v_rebuild_expense_ids uuid[] := array[]::uuid[];
  v_delete_expense_ids uuid[] := array[]::uuid[];
  v_delete_installment_ids uuid[] := array[]::uuid[];
  v_existing_expense_id uuid;
  v_total_installments integer;
  v_paid_installments integer;
  v_installment_amount numeric(14, 2);
  v_due_month date;
  v_current_amount numeric(14, 2);
  v_remaining_amount numeric(14, 2);
  v_baseline_statement numeric(14, 2);
  v_baseline_current numeric(14, 2);
  v_baseline_provision numeric(14, 2);
  v_baseline_scheduled numeric(14, 2);
  v_candidate_statement numeric(14, 2);
  v_residual numeric(14, 2);
  v_statement_adjustments numeric(14, 2) := 0;
  v_aggregate_delta numeric(14, 2);
  v_imported_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_statement_date is null then
    raise exception 'Ekstre kesim tarihi zorunlu.';
  end if;

  if p_bank_amount is null or p_bank_amount < 0 then
    raise exception 'Ekstre banka toplamı geçersiz.';
  end if;

  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'Ekstre aksiyonları dizi olmalı.';
  end if;

  perform 1
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
    and card_type = 'kredi_karti'
  for update;

  if not found then
    raise exception 'Kredi kartı bulunamadı.';
  end if;

  -- Bu kartın açık ekstresi yeniden üretilebilir; paid arşivler tarihsel kanıttır.
  select coalesce(array_agg(id), array[]::uuid[])
  into v_archive_ids
  from public.card_statement_archives
  where card_id = p_card_id
    and user_id = v_user_id
    and coalesce(status, 'open') = 'open';

  -- PDF tarihine kadar olan açık harcamalar ile onların tüm açık taksit planı
  -- yeniden kurulur. PDF tarihinden sonraki tek çekim/provizyon hareketleri kalır.
  select coalesce(array_agg(distinct expense_id), array[]::uuid[])
  into v_rebuild_expense_ids
  from (
    select expense.id as expense_id
    from public.card_expenses expense
    where expense.card_id = p_card_id
      and expense.user_id = v_user_id
      and expense.current_settlement_id is null
      and (
        expense.statement_archive_id = any(v_archive_ids)
        or (expense.statement_archive_id is null and expense.spent_at <= p_statement_date)
      )

    union

    select installment.card_expense_id
    from public.card_installments installment
    where installment.card_id = p_card_id
      and installment.user_id = v_user_id
      and installment.card_expense_id is not null
      and installment.current_settlement_id is null
      and (
        installment.statement_archive_id = any(v_archive_ids)
        or (installment.statement_archive_id is null and installment.due_month <= p_statement_date)
      )
  ) scope
  where expense_id is not null;

  -- Paid/current-settled çocuk taşıyan parent korunur. Diğer parent'lar yeniden
  -- yaratılmak üzere silinir. Korunan parent'a ait yalnız açık çocuklar yenilenir.
  select coalesce(array_agg(expense.id), array[]::uuid[])
  into v_delete_expense_ids
  from public.card_expenses expense
  where expense.id = any(v_rebuild_expense_ids)
    and expense.user_id = v_user_id
    and expense.current_settlement_id is null
    and not exists (
      select 1
      from public.card_installments child
      left join public.card_statement_archives archive
        on archive.id = child.statement_archive_id
      where child.card_expense_id = expense.id
        and (
          child.current_settlement_id is not null
          or (child.statement_archive_id is not null and coalesce(archive.status, 'open') = 'paid')
        )
    );

  select coalesce(array_agg(installment.id), array[]::uuid[])
  into v_delete_installment_ids
  from public.card_installments installment
  left join public.card_statement_archives archive
    on archive.id = installment.statement_archive_id
  where installment.card_id = p_card_id
    and installment.user_id = v_user_id
    and installment.card_expense_id = any(v_rebuild_expense_ids)
    and installment.current_settlement_id is null
    and not (
      installment.statement_archive_id is not null
      and coalesce(archive.status, 'open') = 'paid'
    );

  delete from public.transaction_history
  where user_id = v_user_id
    and (
      (source_table = 'card_installments' and source_id = any(v_delete_installment_ids))
      or (source_table = 'card_expenses' and source_id = any(v_delete_expense_ids))
      or (source_table = 'card_statement_archives' and source_id = any(v_archive_ids))
    );

  -- DELETE bypass yalnız bu fonksiyonun user/card filtreli sorgularında kullanılır.
  perform set_config('app.finance_data_reset_user_id', v_user_id::text, true);

  delete from public.card_installments
  where id = any(v_delete_installment_ids)
    and card_id = p_card_id
    and user_id = v_user_id;

  delete from public.card_expenses
  where id = any(v_delete_expense_ids)
    and card_id = p_card_id
    and user_id = v_user_id;

  delete from public.card_statement_archives
  where id = any(v_archive_ids)
    and card_id = p_card_id
    and user_id = v_user_id;

  perform set_config('app.finance_data_reset_user_id', '', true);

  -- Korunan PDF-sonrası/audit kapsamından kartın canlı başlangıç projeksiyonunu
  -- tekrar üret. Taksit parent'ı ayrıca sayılmaz; açık child'lar borcun kendisidir.
  select coalesce(sum(statement_debt_amount), 0)
  into v_baseline_statement
  from public.card_statement_archives
  where card_id = p_card_id
    and user_id = v_user_id
    and coalesce(status, 'open') = 'open';

  select coalesce(sum(amount), 0)
  into v_baseline_current
  from public.card_expenses expense
  where expense.card_id = p_card_id
    and expense.user_id = v_user_id
    and expense.status = 'posted'
    and expense.installment_count <= 1
    and expense.statement_archive_id is null
    and expense.current_settlement_id is null;

  select v_baseline_current + coalesce(sum(amount), 0)
  into v_baseline_current
  from public.card_installments installment
  where installment.card_id = p_card_id
    and installment.user_id = v_user_id
    and installment.status = 'posted'
    and installment.statement_archive_id is null
    and installment.current_settlement_id is null;

  select coalesce(sum(amount), 0)
  into v_baseline_provision
  from public.card_expenses expense
  where expense.card_id = p_card_id
    and expense.user_id = v_user_id
    and expense.status = 'provision'
    and expense.statement_archive_id is null
    and expense.current_settlement_id is null;

  select coalesce(sum(amount), 0)
  into v_baseline_scheduled
  from public.card_installments installment
  where installment.card_id = p_card_id
    and installment.user_id = v_user_id
    and installment.status = 'scheduled'
    and installment.statement_archive_id is null
    and installment.current_settlement_id is null;

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', 'Ekstre PDF yeniden kurulum başlangıç projeksiyonu', true);

  update public.cards
  set debt_amount = round(v_baseline_statement + v_baseline_current + v_baseline_provision + v_baseline_scheduled, 2),
      statement_debt_amount = round(v_baseline_statement, 2),
      current_period_spending = round(v_baseline_current, 2),
      provision_amount = round(v_baseline_provision, 2),
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;

  perform set_config('app.ledger_kind', '', true);
  perform set_config('app.ledger_note', '', true);

  for v_action in select value from jsonb_array_elements(p_actions)
  loop
    v_kind := coalesce(v_action ->> 'kind', '');

    if v_kind = 'expense' then
      perform public.add_card_expense(
        p_card_id => p_card_id,
        p_amount => (v_action ->> 'amount')::numeric,
        p_description => v_action ->> 'description',
        p_spent_at => (v_action ->> 'spentAt')::date,
        p_installment_count => (v_action ->> 'installmentCount')::integer,
        p_category => coalesce(nullif(v_action ->> 'category', ''), 'Diğer'),
        p_status => 'posted',
        p_user_id => null,
        p_source => 'statement_import',
        p_source_event_id => nullif(v_action ->> 'sourceEventId', '')
      );

    elsif v_kind = 'payment' then
      perform public.pay_payment_from_card_import(
        (v_action ->> 'paymentId')::uuid,
        p_card_id,
        (v_action ->> 'amount')::numeric,
        (v_action ->> 'spentAt')::date,
        nullif(v_action ->> 'sourceEventId', ''),
        'statement_import'
      );

    elsif v_kind = 'adjustment' then
      v_installment_amount := round((v_action ->> 'amount')::numeric, 2);
      if v_installment_amount <= 0 then
        raise exception 'Ekstre alacak/iade tutarı pozitif olmalı.';
      end if;
      v_statement_adjustments := v_statement_adjustments - v_installment_amount;

    elsif v_kind = 'carryover' then
      v_existing_expense_id := nullif(v_action ->> 'existingExpenseId', '')::uuid;
      v_total_installments := (v_action ->> 'totalInstallments')::integer;
      v_paid_installments := (v_action ->> 'paidInstallments')::integer;
      v_installment_amount := round((v_action ->> 'installmentAmount')::numeric, 2);
      v_due_month := (v_action ->> 'nextDueDate')::date;

      select * into v_preserved_expense
      from public.card_expenses
      where id = v_existing_expense_id
        and card_id = p_card_id
        and user_id = v_user_id
      for update;

      if found then
        if v_preserved_expense.installment_count <> v_total_installments then
          raise exception 'Ödenmiş geçmişi olan taksit planının taksit adedi PDF ile uyuşmuyor; tarihsel parent otomatik değiştirilemez.';
        end if;

        if exists (
          select 1
          from public.card_installments installment
          where installment.card_expense_id = v_preserved_expense.id
            and installment.installment_no > v_paid_installments
        ) then
          raise exception 'Korunan taksit geçmişi PDF''deki cari taksit numarasıyla çakışıyor.';
        end if;

        v_current_amount := 0;
        v_remaining_amount := 0;
        for v_installment_no in (v_paid_installments + 1)..v_total_installments
        loop
          v_due_month := ((v_action ->> 'nextDueDate')::date
            + ((v_installment_no - v_paid_installments - 1) || ' month')::interval)::date;

          insert into public.card_installments (
            user_id, card_id, card_expense_id, installment_no, installment_count,
            due_month, amount, description, category, status, posted_at, paid_at, note
          ) values (
            v_user_id, p_card_id, v_preserved_expense.id, v_installment_no, v_total_installments,
            v_due_month, v_installment_amount, v_action ->> 'description',
            coalesce(nullif(v_action ->> 'category', ''), 'Diğer'),
            case when v_due_month <= current_date then 'posted' else 'scheduled' end,
            case when v_due_month <= current_date then now() else null end,
            null,
            case
              when abs(v_preserved_expense.amount - round(v_installment_amount * v_total_installments, 2)) > 1
                then format(
                  'Ekstre PDF kaynak gerçeğinden yeniden kuruldu. Tarihsel parent toplamı %s TL korundu; PDF taksit projeksiyonu %s TL.',
                  v_preserved_expense.amount,
                  round(v_installment_amount * v_total_installments, 2)
                )
              else 'Ekstre PDF kaynak gerçeğinden yeniden kuruldu.'
            end
          );

          v_remaining_amount := v_remaining_amount + v_installment_amount;
          if v_due_month <= current_date then
            v_current_amount := v_current_amount + v_installment_amount;
          end if;
        end loop;

        update public.cards
        set debt_amount = debt_amount + round(v_remaining_amount, 2),
            current_period_spending = current_period_spending + round(v_current_amount, 2),
            updated_at = now()
        where id = p_card_id and user_id = v_user_id;

      else
        perform public.record_card_installment_carryover(
          p_card_id,
          v_action ->> 'description',
          v_installment_amount,
          v_total_installments,
          v_paid_installments,
          v_due_month,
          coalesce(nullif(v_action ->> 'category', ''), 'Diğer'),
          nullif(v_action ->> 'sourceEventId', '')
        );
      end if;
    else
      raise exception 'Desteklenmeyen ekstre aksiyonu: %', v_kind;
    end if;

    v_imported_count := v_imported_count + 1;
  end loop;

  -- PDF toplamı yalnız ekstre kesim kapsamının kaynağıdır. Sonraki dönem
  -- hareketlerini bozmadan, kesilecek miktarı banka toplamına getir.
  select coalesce(sum(amount), 0)
  into v_candidate_statement
  from public.card_expenses expense
  where expense.card_id = p_card_id
    and expense.user_id = v_user_id
    and expense.status = 'posted'
    and expense.installment_count <= 1
    and expense.statement_archive_id is null
    and expense.current_settlement_id is null
    and expense.spent_at <= p_statement_date;

  select v_candidate_statement + coalesce(sum(amount), 0)
  into v_candidate_statement
  from public.card_installments installment
  where installment.card_id = p_card_id
    and installment.user_id = v_user_id
    and installment.status = 'posted'
    and installment.statement_archive_id is null
    and installment.current_settlement_id is null
    and installment.due_month <= p_statement_date;

  v_candidate_statement := round(v_candidate_statement + v_statement_adjustments, 2);

  v_residual := round(p_bank_amount - v_candidate_statement, 2);
  v_aggregate_delta := round(v_statement_adjustments + v_residual, 2);
  if v_aggregate_delta <> 0 then
    if v_candidate_statement + v_residual < 0 then
      raise exception 'Ekstre toplamı negatif projeksiyon üretiyor.';
    end if;

    perform set_config('app.ledger_kind', 'adjustment', true);
    perform set_config('app.ledger_note', 'Ekstre PDF banka toplamına atomik kilit', true);
    update public.cards
    set debt_amount = greatest(0, debt_amount + v_aggregate_delta),
        current_period_spending = greatest(0, current_period_spending + v_aggregate_delta),
        updated_at = now()
    where id = p_card_id and user_id = v_user_id;
    perform set_config('app.ledger_kind', '', true);
    perform set_config('app.ledger_note', '', true);
  end if;

  v_archive := public.cut_card_statement(p_card_id);

  if v_archive.statement_date <> p_statement_date then
    raise exception 'PDF kesim tarihi (%) kartın hesaplanan kesim tarihiyle (%) uyuşmuyor.',
      p_statement_date, v_archive.statement_date;
  end if;

  if p_due_date is not null and v_archive.due_date is distinct from p_due_date then
    raise exception 'PDF son ödeme tarihi (%) kartın hesaplanan tarihiyle (%) uyuşmuyor.',
      p_due_date, v_archive.due_date;
  end if;

  perform public.set_statement_reconciliation(
    p_card_id,
    extract(year from p_statement_date)::integer,
    extract(month from p_statement_date)::integer,
    p_bank_amount,
    'Ekstre PDF kaynak gerçeğinden atomik yeniden kuruldu.'
  );

  return jsonb_build_object(
    'importedCount', v_imported_count,
    'statementId', v_archive.id,
    'bankAmount', round(p_bank_amount, 2)
  );
end;
$$;

revoke execute on function public.replace_card_statement_import(uuid, date, date, numeric, jsonb) from public;
revoke execute on function public.replace_card_statement_import(uuid, date, date, numeric, jsonb) from anon;
grant execute on function public.replace_card_statement_import(uuid, date, date, numeric, jsonb) to authenticated;
