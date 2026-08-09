-- Banka ekranındaki toplam kalan kart yükünü kaynak gerçek kabul eder.
-- Toplam borç düzeltmesi dönem/ekstre/provizyon kovalarını değiştirmez.
-- Ayrıca, tutarı tam kanıtlanan eski ödenmiş ekstre çocuklarını tarihsel
-- arşive bağlayarak sonraki erken ödeme akışının onları yeniden saymasını önler.

create or replace function public.reconcile_card_bank_snapshot(
  p_card_id uuid,
  p_bank_total_kurus bigint,
  p_note text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_archive public.card_statement_archives%rowtype;
  v_bank_total numeric(14, 2);
  v_minimum_visible numeric(14, 2);
  v_linked_total numeric(14, 2);
  v_candidate_total numeric(14, 2);
  v_gap numeric(14, 2);
  v_repaired_count integer;
  v_updated_count integer;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_bank_total_kurus is null or p_bank_total_kurus < 0 then
    raise exception 'Bankadaki toplam kart yükü negatif olamaz.';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'Mutabakat için açıklama zorunlu.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
    and card_type = 'kredi_karti'
  for update;

  if not found then
    raise exception 'Mutabakat yapılacak kredi kartı bulunamadı.';
  end if;

  -- Eski sürümlerde ekstre aggregate olarak ödenmiş, fakat bazı çocuklar
  -- arşive bağlanmadan kalmış olabilir. Yalnız mevcut bağlı toplam + tarihe
  -- kadar olan tüm açık adaylar arşiv tutarına TAM eşitse bağlantı kurulur.
  -- Belirsiz/kısmi eşleşmede hiçbir tarihsel satıra dokunulmaz.
  for v_archive in
    select *
    from public.card_statement_archives
    where user_id = v_user_id
      and card_id = p_card_id
      and status = 'paid'
    order by statement_date, id
    for update
  loop
    select round(
      coalesce((
        select sum(expense.amount)
        from public.card_expenses expense
        where expense.user_id = v_user_id
          and expense.card_id = p_card_id
          and expense.status <> 'cancelled'
          and expense.installment_count <= 1
          and expense.statement_archive_id = v_archive.id
      ), 0)
      + coalesce((
        select sum(installment.amount)
        from public.card_installments installment
        where installment.user_id = v_user_id
          and installment.card_id = p_card_id
          and installment.statement_archive_id = v_archive.id
      ), 0),
      2
    ) into v_linked_total;

    select round(
      coalesce((
        select sum(expense.amount)
        from public.card_expenses expense
        where expense.user_id = v_user_id
          and expense.card_id = p_card_id
          and expense.status = 'posted'
          and expense.installment_count <= 1
          and expense.statement_archive_id is null
          and expense.current_settlement_id is null
          and expense.spent_at <= v_archive.statement_date
      ), 0)
      + coalesce((
        select sum(installment.amount)
        from public.card_installments installment
        where installment.user_id = v_user_id
          and installment.card_id = p_card_id
          and installment.status = 'posted'
          and installment.statement_archive_id is null
          and installment.current_settlement_id is null
          and installment.due_month <= v_archive.statement_date
      ), 0),
      2
    ) into v_candidate_total;

    v_gap := round(v_archive.statement_debt_amount - v_linked_total, 2);

    if v_gap > 0 and v_candidate_total = v_gap then
      perform set_config('app.card_statement_allocation_user_id', v_user_id::text, true);

      update public.card_expenses
      set statement_archive_id = v_archive.id,
          updated_at = now()
      where user_id = v_user_id
        and card_id = p_card_id
        and status = 'posted'
        and installment_count <= 1
        and statement_archive_id is null
        and current_settlement_id is null
        and spent_at <= v_archive.statement_date;

      get diagnostics v_repaired_count = row_count;

      update public.card_installments
      set statement_archive_id = v_archive.id,
          updated_at = now()
      where user_id = v_user_id
        and card_id = p_card_id
        and status = 'posted'
        and statement_archive_id is null
        and current_settlement_id is null
        and due_month <= v_archive.statement_date;

      get diagnostics v_updated_count = row_count;
      v_repaired_count := v_repaired_count + v_updated_count;
      perform set_config('app.card_statement_allocation_user_id', '', true);

      insert into public.transaction_history (
        user_id, type, title, amount, source_table, source_id, note
      ) values (
        v_user_id,
        'correction',
        v_card.card_name || ' tarihsel ekstre bağlantısı onarıldı',
        v_gap,
        'card_statement_archives',
        v_archive.id,
        format('%s hareket banka tutarıyla tam eşleşti. %s', v_repaired_count, btrim(p_note))
      );
    end if;
  end loop;

  v_bank_total := p_bank_total_kurus / 100.0;
  v_minimum_visible := round(
    greatest(0, v_card.statement_debt_amount)
      + greatest(0, v_card.current_period_spending)
      + greatest(0, v_card.provision_amount),
    2
  );

  if v_bank_total < v_minimum_visible then
    raise exception 'Banka toplamı görünür ekstre/dönem/provizyon toplamından küçük olamaz.';
  end if;

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', btrim(p_note), true);

  update public.cards
  set debt_amount = v_bank_total,
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;

  perform set_config('app.ledger_kind', '', true);
  perform set_config('app.ledger_note', '', true);

  return v_bank_total;
end;
$$;

revoke execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text) from public;
revoke execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text) from anon;
grant execute on function public.reconcile_card_bank_snapshot(uuid, bigint, text) to authenticated;
