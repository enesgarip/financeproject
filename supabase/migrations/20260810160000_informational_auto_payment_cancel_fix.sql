-- Faz BM-5: Uyuyan-akış denetimi düzeltmeleri (1/2 — DB tarafı).
--
-- 5a — Kart talimatlı ödeme BİLGİLENDİRME moduna iner. Gerekçe (denetim B-1):
--   tahmini tutarı proaktif karta yazan iki kaynak vardı (istemci hook'u vade
--   günü + bu RPC ertesi gün) ve SMS ile tutar sapması çift harcama üretebilirdi.
--   Banka modelinde gerçek kayıt tek kaynaktan gelir: SMS anlık yazar ve planı
--   ilerletir (record_sms_card_expense eşleşmesi KORUNUR), SMS kaçarsa aylık
--   ekstre importu satırı getirip planı kapatır (pay_payment_from_card_import).
--   Talimat takvim/hatırlatma katmanında bilgi olarak yaşamaya devam eder;
--   manuel "Öde" her zaman mümkündür. Proaktif tahmini yazma tümüyle kalkar.
--
-- 5b — cancel_card_expense borç terslemesi planın GERÇEK borç katkısına iner.
--   Devreden (carryover) planda parent.amount tam plan toplamını taşır ama borca
--   yalnız kalan taksitler eklenmiştir; iptalde amount kadar düşmek borcu
--   fazladan siliyordu. Yeni kural: posted çok taksitli planda tersleme = child
--   satır toplamı (arşivli child zaten iptali bloklar; kalan çocuklar planın
--   borca eklenmiş kısmının kendisidir). add_card_expense planlarında çocuk
--   toplamı = amount olduğundan davranış değişmez. Çocuksuz legacy plan
--   fallback'i amount kalır (o modelde borç tam tutarla açılmıştı).

drop function if exists public.post_due_card_auto_payments();

create or replace function public.cancel_card_expense(
  p_expense_id uuid
)
returns public.card_expenses
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_initial_card_id uuid;
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_cancelled public.card_expenses%rowtype;
  v_debt_reversal numeric(14, 2);
  v_current_period_reversal numeric(14, 2) := 0;
  v_statement_reversal numeric(14, 2) := 0;
  v_provision_reversal numeric(14, 2) := 0;
  v_installment_total numeric(14, 2) := 0;
  v_installment_rows integer := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  -- Follow the canonical card -> child lock order used by statement cutting.
  -- The first read is intentionally unlocked; the row is re-read and
  -- revalidated after the card lock.
  select card_id
  into v_initial_card_id
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Harcama bulunamadı.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_initial_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
    and card_id = v_card.id
  for update;

  if not found then
    raise exception 'Harcama bulunamadı veya kartı değişti; yeniden deneyin.';
  end if;

  if v_expense.status = 'cancelled' then
    raise exception 'Bu harcama zaten iptal edilmiş.';
  end if;

  if v_expense.statement_archive_id is not null
     or exists (
       select 1
       from public.card_installments installment
       where installment.card_expense_id = v_expense.id
         and installment.statement_archive_id is not null
     ) then
    raise exception 'Ekstreye kesilmiş kart harcaması iptal edilemez; düzeltme/uzlaştırma akışını kullanın.';
  end if;

  v_debt_reversal := v_expense.amount;

  if v_card.card_type = 'kredi_karti' then
    if v_expense.status = 'provision' then
      v_provision_reversal := v_expense.amount;
    elsif coalesce(v_expense.installment_count, 1) > 1 then
      select
        coalesce(sum(amount), 0),
        coalesce(sum(amount) filter (
          where status = 'posted' and statement_archive_id is null
        ), 0),
        coalesce(sum(amount) filter (
          where status = 'posted' and statement_archive_id is not null
        ), 0),
        count(*)
      into v_installment_total, v_current_period_reversal, v_statement_reversal, v_installment_rows
      from public.card_installments
      where card_expense_id = v_expense.id
        and user_id = v_user_id;

      -- 5b: Planın borca eklenmiş katkısı child toplamıdır (devreden planda
      -- parent.amount tam plan olsa da borca yalnız kalan girmiştir).
      if v_installment_rows > 0 then
        v_debt_reversal := v_installment_total;
      end if;

      -- Legacy multi-installment expenses may have no child rows. Existing
      -- all-scheduled rows legitimately have zero visible-bucket impact and
      -- must not consume unrelated current-period spending on cancellation.
      if v_installment_rows = 0 then
        v_current_period_reversal := coalesce(
          nullif(v_expense.installment_amount, 0),
          round(v_expense.amount / greatest(1, v_expense.installment_count), 2)
        );
      end if;
    elsif v_expense.statement_archive_id is not null then
      v_statement_reversal := v_expense.amount;
    else
      v_current_period_reversal := v_expense.amount;
    end if;

    update public.cards
    set debt_amount = greatest(0, debt_amount - v_debt_reversal),
        statement_debt_amount = greatest(0, statement_debt_amount - v_statement_reversal),
        current_period_spending = greatest(0, current_period_spending - v_current_period_reversal),
        provision_amount = greatest(0, provision_amount - v_provision_reversal),
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance + v_expense.amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  delete from public.card_installments
  where card_expense_id = v_expense.id
    and user_id = v_user_id;

  update public.card_expenses
  set status = 'cancelled',
      updated_at = now()
  where id = v_expense.id
  returning * into v_cancelled;

  insert into public.transaction_history (
    user_id, type, title, amount, source_table, source_id, note
  )
  values (
    v_user_id,
    'correction',
    v_expense.description || ' iptal edildi',
    v_debt_reversal,
    'card_expenses',
    v_expense.id,
    'Mutabakat sırasında iptal edildi. Orijinal tarih: '
      || to_char(v_expense.spent_at, 'YYYY-MM-DD')
  );

  return v_cancelled;
end;
$$;

revoke execute on function public.cancel_card_expense(uuid) from public;
revoke execute on function public.cancel_card_expense(uuid) from anon;
grant execute on function public.cancel_card_expense(uuid) to authenticated;
