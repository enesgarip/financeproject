-- Harcama kaydının KAYNAĞI (otomasyon kapsamı ölçümü).
--
-- Problem: SMS'ten gelen, PDF import'tan gelen ve elle yazılan harcama
-- veritabanında birbirinin aynı görünüyordu. "Manuel yükü azaltalım" derken
-- nereye yatırım yapacağımızı tahminle seçiyorduk. Bu kolon ölçmeyi mümkün kılar.
--
-- NULL = eski kayıt (bilinmiyor). Yeni kayıtlar `add_card_expense`'e geçilen
-- p_source ile etiketlenir; varsayılan 'manual' çünkü etiketlenmemiş her yol
-- pratikte elle giriştir.
--
-- Not: pay_payment (kart talimatlı ödeme) ve record_card_installment_carryover
-- da card_expenses yazar; bunlar ayırt edici note metni taşıdığı için istemci
-- tarafındaki sınıflandırıcı (utils/automationCoverage.ts) note'tan türetir.
-- Bu fonksiyonları yeniden yazmak, kazancına göre yüksek riskli.

alter table public.card_expenses
  add column if not exists source text;

alter table public.card_expenses
  drop constraint if exists card_expenses_source_check;

alter table public.card_expenses
  add constraint card_expenses_source_check check (
    source is null or source in (
      'manual',            -- hızlı harcama formu / taksitli harcama formu
      'sms',               -- parse-sms otomasyonu
      'statement_import',  -- ekstre PDF import
      'movement_import',   -- güncel hareket PDF import
      'receipt_scan',      -- fiş fotoğrafı (parse-receipt)
      'payment_auto',      -- kart talimatlı planlı ödeme
      'carryover'          -- import öncesi taksit devri
    )
  );

create index if not exists card_expenses_source_idx
  on public.card_expenses (user_id, source);

-- add_card_expense: p_source eklenir. Eski 8 argümanlı imza DÜŞÜRÜLÜR; aksi
-- halde 8 argümanlı çağrı iki aşırı yükle de eşleşip "ambiguous" hatası verir.
-- Deploy sırasında eski frontend 8 isimli argüman göndermeye devam eder,
-- p_source varsayılanı sayesinde sorunsuz çalışır.
drop function if exists public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid);

create or replace function public.add_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default current_date,
  p_installment_count integer default 1,
  p_category text default 'Diğer',
  p_status text default 'posted',
  p_user_id uuid default null,
  p_source text default 'manual'
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $function$
declare
  v_user_id uuid := coalesce(p_user_id, (select auth.uid()));
  v_card public.cards%rowtype;
  v_expense public.card_expenses%rowtype;
  v_installment_count integer := greatest(1, least(coalesce(p_installment_count, 1), 36));
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_spent_at date := coalesce(p_spent_at, current_date);
  v_status text := case
    when lower(btrim(coalesce(p_status, 'posted'))) = 'provision' then 'provision'
    else 'posted'
  end;
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Diğer');
  v_current_period_amount numeric(14, 2) := 0;
  v_source text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'manual');
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutari 0''dan buyuk olmali.';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama aciklamasi zorunlu.';
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

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

  if v_card.card_type = 'banka_karti' and v_card.current_balance < p_amount then
    raise exception 'Banka karti bakiyesi yetersiz.';
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_status = 'posted' then
    if v_installment_count > 1 then
      for v_installment_no in 1..v_installment_count loop
        v_installment_amount := round(p_amount / v_installment_count, 2);
        if v_installment_no = v_installment_count then
          v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
        end if;

        v_due_month := (v_spent_at + ((v_installment_no - 1) * interval '1 month'))::date;
        if v_due_month <= current_date then
          v_current_period_amount := v_current_period_amount + v_installment_amount;
        end if;
      end loop;
    else
      v_current_period_amount := p_amount;
    end if;
  end if;

  if v_card.card_type = 'kredi_karti' then
    update public.cards
    set debt_amount = debt_amount + case when v_status = 'posted' then p_amount else 0 end,
        current_period_spending = current_period_spending + v_current_period_amount,
        provision_amount = provision_amount + case when v_status = 'provision' then p_amount else 0 end,
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance - p_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

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
    source
  )
  values (
    v_user_id,
    p_card_id,
    v_spent_at,
    p_amount,
    btrim(coalesce(p_description, '')),
    v_category,
    v_installment_count,
    v_first_installment_amount,
    v_status,
    case when v_status = 'posted' then now() else null end,
    v_source
  )
  returning * into v_expense;

  if v_card.card_type = 'kredi_karti' and v_status = 'posted' and v_installment_count > 1 then
    for v_installment_no in 1..v_installment_count loop
      v_installment_amount := round(p_amount / v_installment_count, 2);
      if v_installment_no = v_installment_count then
        v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
      end if;

      v_due_month := (v_spent_at + ((v_installment_no - 1) * interval '1 month'))::date;

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
        p_card_id,
        v_expense.id,
        v_installment_no,
        v_installment_count,
        v_due_month,
        v_installment_amount,
        btrim(coalesce(p_description, '')),
        v_category,
        case when v_due_month <= current_date then 'posted' else 'scheduled' end,
        case when v_due_month <= current_date then now() else null end
      );
    end loop;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'card',
    btrim(coalesce(p_description, '')),
    p_amount,
    'card_expenses',
    v_expense.id,
    case
      when v_status = 'provision' then 'Kart harcamasi provizyona alindi.'
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcamasi.'
      else 'Pesin kart harcamasi.'
    end
  );

  return v_expense;
end;
$function$;

grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid, text) to authenticated;
grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid, text) to service_role;
