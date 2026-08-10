-- Faz BM-6: İptal edilen kayıt kaynak-olay kimliğini sonsuza dek rezerve etmez.
--
-- Denetim İptal-B2: unique index ve idempotensi lookup'ları status'a bakmıyordu.
-- Yanlışlıkla iptal edilen bir import/manuel kaydı yeniden içe aktarmak sessizce
-- iptal edilmiş satırı "başarı" olarak döndürüyor, hiçbir şey oluşmuyordu —
-- kullanıcı için hatasız ama kırılamayan bir döngü (iptali geri almanın tek yolu
-- da buydu). Yeni model: iptal kimliği SERBEST bırakır; aynı satırı yeniden
-- import etmek TAZE bir kayıt oluşturur (= iptali geri almanın kanonik yolu).
--
-- Retry güvenliği korunur: gerçek retry'lar saniyeler içinde gelir (insan iptali
-- araya giremez) ve advisory lock + iptal-dışı unique index aynı anda ikinci
-- kaydı hâlâ engeller. İptalden SONRA gelen birebir aynı kimlik, retry değil
-- bilinçli yeniden içe aktarmadır.
--
-- Kapsam: add_card_expense (10 arg), record_card_installment_carryover (8 arg),
-- pay_payment_from_card_import (6 arg). record_sms_card_expense BİLEREK dışarıda:
-- SMS webhook retry'ı insan onayı taşımaz; iptal edilmiş SMS kaydının aynı
-- metinle geri dirilmemesi güvenli taraftır (gerekirse satır ekstre importuyla
-- geri gelir).

drop index if exists public.card_expenses_source_event_unique_idx;
create unique index card_expenses_source_event_unique_idx
  on public.card_expenses (user_id, source, source_event_id)
  where source_event_id is not null and status <> 'cancelled';

create or replace function public.add_card_expense(
  p_card_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default current_date,
  p_installment_count integer default 1,
  p_category text default 'Diğer',
  p_status text default 'posted',
  p_user_id uuid default null,
  p_source text default 'manual',
  p_source_event_id text default null
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
  v_source_event_id text := nullif(btrim(coalesce(p_source_event_id, '')), '');
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

  if v_source_event_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_user_id::text || '|' || v_source || '|' || v_source_event_id,
      0
    ));

    -- BM-6: iptal edilmiş satır kimliği rezerve etmez; yeniden import taze
    -- kayıt oluşturur (iptali geri almanın kanonik yolu).
    select *
    into v_expense
    from public.card_expenses
    where user_id = v_user_id
      and source = v_source
      and source_event_id = v_source_event_id
      and status <> 'cancelled';

    if found then
      return v_expense;
    end if;
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
    set debt_amount = debt_amount + p_amount,
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
    user_id, card_id, spent_at, amount, description, category,
    installment_count, installment_amount, status, posted_at, source, source_event_id
  ) values (
    v_user_id, p_card_id, v_spent_at, p_amount, btrim(coalesce(p_description, '')), v_category,
    v_installment_count, v_first_installment_amount, v_status,
    case when v_status = 'posted' then now() else null end, v_source, v_source_event_id
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
        user_id, card_id, card_expense_id, installment_no, installment_count,
        due_month, amount, description, category, status, posted_at
      ) values (
        v_user_id, p_card_id, v_expense.id, v_installment_no, v_installment_count,
        v_due_month, v_installment_amount, btrim(coalesce(p_description, '')), v_category,
        case when v_due_month <= current_date then 'posted' else 'scheduled' end,
        case when v_due_month <= current_date then now() else null end
      );
    end loop;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id, 'card', btrim(coalesce(p_description, '')), p_amount, 'card_expenses', v_expense.id,
    case
      when v_status = 'provision' then 'Kart harcamasi provizyona alindi.'
      when v_installment_count > 1 then v_installment_count || ' taksitli kart harcamasi.'
      else 'Pesin kart harcamasi.'
    end
  );

  return v_expense;
end;
$function$;

revoke execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid, text, text) from public;
revoke execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid, text, text) from anon;
grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid, text, text) to authenticated;
grant execute on function public.add_card_expense(uuid, numeric, text, date, integer, text, text, uuid, text, text) to service_role;

create or replace function public.record_card_installment_carryover(
  p_card_id uuid,
  p_description text,
  p_installment_amount numeric,
  p_total_installments integer,
  p_paid_installments integer,
  p_next_due_month date,
  p_category text,
  p_source_event_id text
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_event_id text := nullif(btrim(coalesce(p_source_event_id, '')), '');
  v_expense public.card_expenses%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if v_event_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_user_id::text || '|carryover|' || v_event_id,
      0
    ));
    -- BM-6: iptal edilmiş devir kimliği rezerve etmez; yeniden import planı
    -- taze kurar.
    select * into v_expense
    from public.card_expenses
    where user_id = v_user_id
      and source = 'carryover'
      and source_event_id = v_event_id
      and status <> 'cancelled';
    if found then return v_expense; end if;
  end if;

  v_expense := public.record_card_installment_carryover(
    p_card_id, p_description, p_installment_amount, p_total_installments,
    p_paid_installments, p_next_due_month, p_category
  );

  update public.card_expenses
  set source = 'carryover', source_event_id = v_event_id
  where id = v_expense.id
  returning * into v_expense;
  return v_expense;
end;
$function$;

revoke execute on function public.record_card_installment_carryover(uuid, text, numeric, integer, integer, date, text, text) from public;
revoke execute on function public.record_card_installment_carryover(uuid, text, numeric, integer, integer, date, text, text) from anon;
grant execute on function public.record_card_installment_carryover(uuid, text, numeric, integer, integer, date, text, text) to authenticated;

create or replace function public.pay_payment_from_card_import(
  p_payment_id uuid,
  p_source_card_id uuid,
  p_paid_amount numeric,
  p_spent_at date,
  p_source_event_id text,
  p_source text
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_event_id text := nullif(btrim(coalesce(p_source_event_id, '')), '');
  v_expense public.card_expenses%rowtype;
  v_payment public.payments%rowtype;
  v_source text := btrim(coalesce(p_source, ''));
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if v_source not in ('statement_import', 'movement_import') then
    raise exception 'Gecersiz import kaynagi.';
  end if;

  if v_event_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_user_id::text || '|' || v_source || '|' || v_event_id,
      0
    ));
    -- BM-6: iptal edilmiş import kaydı kimliği rezerve etmez.
    select * into v_expense
    from public.card_expenses
    where user_id = v_user_id
      and source = v_source
      and source_event_id = v_event_id
      and status <> 'cancelled';
    if found then
      select * into v_payment from public.payments where id = p_payment_id and user_id = v_user_id;
      if not found then raise exception 'Odeme bulunamadi.'; end if;
      return v_payment;
    end if;
  end if;

  v_payment := public.pay_payment_from_card_import(
    p_payment_id, p_source_card_id, p_paid_amount, p_spent_at
  );

  select * into v_expense
  from public.card_expenses
  where user_id = v_user_id
    and card_id = p_source_card_id
    and xmin::text = pg_catalog.pg_current_xact_id()::text
    and note like 'Odeme kaydindan import ile olusturuldu.%'
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Import harcamasi bulunamadi.';
  end if;

  update public.card_expenses
  set source = v_source, source_event_id = v_event_id
  where id = v_expense.id;
  return v_payment;
end;
$function$;

revoke execute on function public.pay_payment_from_card_import(uuid, uuid, numeric, date, text, text) from public;
revoke execute on function public.pay_payment_from_card_import(uuid, uuid, numeric, date, text, text) from anon;
grant execute on function public.pay_payment_from_card_import(uuid, uuid, numeric, date, text, text) to authenticated;
