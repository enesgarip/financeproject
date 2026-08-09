-- Eski pay_card_debt sürümleri kısmi/aggregate ödemeyi kart toplamından düşürürken
-- child hareketlere settlement marker yazmıyordu. Sonraki tam dönem ödemesinde bu
-- tarihsel satırlar yeniden sayılıp güvenlik kontrolünü kilitleyebiliyor.
--
-- Tam dönem ödemesi sırasında yalnız şu kanıt birlikte sağlanırsa eski satırlar
-- ayrı, nakit hareketi yaratmayan bir tarihsel repair settlement'ına bağlanır:
--   1) allocation'sız posted toplam, current_period_spending'den büyük,
--   2) farkın tamamı aktif hesap kesim döneminden önceki satırlardan oluşuyor,
--   3) bu iki tutar kuruşu kuruşuna eşit.

alter table public.card_current_settlements
  alter column source_card_id drop not null;

alter table public.card_current_settlements
  add column if not exists settlement_kind text not null default 'payment';

alter table public.card_current_settlements
  drop constraint if exists card_current_settlements_kind_check;

alter table public.card_current_settlements
  add constraint card_current_settlements_kind_check
  check (settlement_kind in ('payment', 'historical_repair'));

alter table public.card_current_settlements
  drop constraint if exists card_current_settlements_source_kind_check;

alter table public.card_current_settlements
  add constraint card_current_settlements_source_kind_check
  check (
    (settlement_kind = 'payment' and source_card_id is not null)
    or (settlement_kind = 'historical_repair' and source_card_id is null)
  );

create or replace function public.pay_card_debt(
  p_card_id uuid,
  p_source_card_id uuid,
  p_amount numeric
)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_paid_card public.cards%rowtype;
  v_settlement public.card_current_settlements%rowtype;
  v_repair_settlement public.card_current_settlements%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_payable_amount numeric(14, 2);
  v_remaining_payment numeric(14, 2);
  v_next_statement_debt numeric(14, 2);
  v_next_current_period numeric(14, 2);
  v_single_total numeric(14, 2) := 0;
  v_installment_total numeric(14, 2) := 0;
  v_unallocated_total numeric(14, 2) := 0;
  v_historical_single_total numeric(14, 2) := 0;
  v_historical_installment_total numeric(14, 2) := 0;
  v_historical_total numeric(14, 2) := 0;
  v_unallocated_excess numeric(14, 2) := 0;
  v_this_boundary date;
  v_previous_month_start date;
  v_cycle_start date;
  v_is_full_current_settlement boolean := false;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if v_amount <= 0 then
    raise exception 'Ödeme tutarı 0''dan büyük olmalı.';
  end if;

  if p_card_id = p_source_card_id then
    raise exception 'Kaynak hesap ve borç kartı aynı olamaz.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Borç ödenecek kredi kartı bulunamadı.';
  end if;

  v_payable_amount := greatest(0, v_card.statement_debt_amount + v_card.current_period_spending);

  if v_payable_amount <= 0 then
    raise exception 'Ödenecek kesinleşmiş kart borcu yok.';
  end if;

  if v_amount > v_payable_amount then
    raise exception 'Ödeme tutarı ekstre ve dönem içi kesinleşmiş kart borcundan büyük olamaz.';
  end if;

  v_is_full_current_settlement :=
    v_card.statement_debt_amount = 0
    and v_amount = v_card.current_period_spending;

  if v_is_full_current_settlement then
    select coalesce(sum(amount), 0)
    into v_single_total
    from public.card_expenses
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and installment_count <= 1
      and statement_archive_id is null
      and current_settlement_id is null;

    select coalesce(sum(amount), 0)
    into v_installment_total
    from public.card_installments
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and statement_archive_id is null
      and current_settlement_id is null;

    v_unallocated_total := round(v_single_total + v_installment_total, 2);
    v_unallocated_excess := round(v_unallocated_total - v_card.current_period_spending, 2);

    if v_unallocated_excess > 0 and v_card.statement_day is not null then
      v_this_boundary := make_date(
        extract(year from current_date)::integer,
        extract(month from current_date)::integer,
        least(
          v_card.statement_day,
          extract(day from (date_trunc('month', current_date)::date + interval '1 month - 1 day'))::integer
        )
      );

      if current_date > v_this_boundary then
        v_cycle_start := v_this_boundary + 1;
      else
        v_previous_month_start := (date_trunc('month', current_date) - interval '1 month')::date;
        v_cycle_start := make_date(
          extract(year from v_previous_month_start)::integer,
          extract(month from v_previous_month_start)::integer,
          least(
            v_card.statement_day,
            extract(day from (v_previous_month_start + interval '1 month - 1 day'))::integer
          )
        ) + 1;
      end if;

      select coalesce(sum(amount), 0)
      into v_historical_single_total
      from public.card_expenses
      where user_id = v_user_id
        and card_id = v_card.id
        and status = 'posted'
        and installment_count <= 1
        and statement_archive_id is null
        and current_settlement_id is null
        and spent_at < v_cycle_start;

      select coalesce(sum(amount), 0)
      into v_historical_installment_total
      from public.card_installments
      where user_id = v_user_id
        and card_id = v_card.id
        and status = 'posted'
        and statement_archive_id is null
        and current_settlement_id is null
        and due_month < v_cycle_start;

      v_historical_total := round(v_historical_single_total + v_historical_installment_total, 2);

      if v_historical_total = v_unallocated_excess then
        insert into public.card_current_settlements (
          user_id, card_id, source_card_id, amount, settled_at, note, settlement_kind
        )
        values (
          v_user_id,
          v_card.id,
          null,
          v_historical_total,
          now(),
          'Eski aggregate kart ödemesinin eksik hareket dağılımı onarıldı; yeni nakit çıkışı yaratılmadı.',
          'historical_repair'
        )
        returning * into v_repair_settlement;

        perform set_config(
          'app.card_current_settlement_allocation_user_id',
          v_user_id::text,
          true
        );

        update public.card_expenses
        set current_settlement_id = v_repair_settlement.id,
            updated_at = now()
        where user_id = v_user_id
          and card_id = v_card.id
          and status = 'posted'
          and installment_count <= 1
          and statement_archive_id is null
          and current_settlement_id is null
          and spent_at < v_cycle_start;

        update public.card_installments
        set current_settlement_id = v_repair_settlement.id,
            status = 'paid',
            paid_at = now(),
            updated_at = now()
        where user_id = v_user_id
          and card_id = v_card.id
          and status = 'posted'
          and statement_archive_id is null
          and current_settlement_id is null
          and due_month < v_cycle_start;

        perform set_config('app.card_current_settlement_allocation_user_id', '', true);

        insert into public.transaction_history (
          user_id, type, title, amount, source_table, source_id, note
        ) values (
          v_user_id,
          'correction',
          v_card.card_name || ' tarihsel ödeme dağılımı onarıldı',
          v_historical_total,
          'card_current_settlements',
          v_repair_settlement.id,
          'Eski aggregate ödeme hareketlere bağlandı; hesap bakiyesi ve kart toplamı değişmedi.'
        );

        v_single_total := round(v_single_total - v_historical_single_total, 2);
        v_installment_total := round(v_installment_total - v_historical_installment_total, 2);
      end if;
    end if;

    if round(v_single_total + v_installment_total, 2) <> v_card.current_period_spending then
      raise exception 'Güncel borcun hareket dağılımı uyuşmuyor. Önce Veri Sağlığı kontrolünü çalıştır.';
    end if;
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_amount);

  if v_is_full_current_settlement then
    insert into public.card_current_settlements (
      user_id, card_id, source_card_id, amount, settled_at, note, settlement_kind
    )
    values (
      v_user_id,
      v_card.id,
      v_source.id,
      v_amount,
      now(),
      'Ekstre kesilmeden güncel borcun tamamı ödendi.',
      'payment'
    )
    returning * into v_settlement;

    perform set_config(
      'app.card_current_settlement_allocation_user_id',
      v_user_id::text,
      true
    );

    update public.card_expenses
    set current_settlement_id = v_settlement.id,
        updated_at = now()
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and installment_count <= 1
      and statement_archive_id is null
      and current_settlement_id is null;

    update public.card_installments
    set current_settlement_id = v_settlement.id,
        status = 'paid',
        paid_at = now(),
        updated_at = now()
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and statement_archive_id is null
      and current_settlement_id is null;

    perform set_config('app.card_current_settlement_allocation_user_id', '', true);
  end if;

  v_remaining_payment := v_amount;
  v_next_statement_debt := greatest(0, v_card.statement_debt_amount - v_remaining_payment);
  v_remaining_payment := greatest(0, v_remaining_payment - v_card.statement_debt_amount);
  v_next_current_period := greatest(0, v_card.current_period_spending - v_remaining_payment);

  update public.cards
  set debt_amount = greatest(0, debt_amount - v_amount),
      statement_debt_amount = v_next_statement_debt,
      current_period_spending = v_next_current_period,
      updated_at = now()
  where id = v_card.id
  returning * into v_paid_card;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_card.card_name || case
      when v_is_full_current_settlement then ' güncel borcu kapatıldı'
      else ' kart borcu ödendi'
    end,
    v_amount,
    case when v_is_full_current_settlement then 'card_current_settlements' else 'cards' end,
    case when v_is_full_current_settlement then v_settlement.id else v_card.id end,
    v_source.card_name || ' hesabından ödendi. ' || case
      when v_is_full_current_settlement
      then 'Dönem içi hareketler ve vadesi gelmiş taksitler erken kapatıldı.'
      else 'Gelecek kredi kartı taksitleri kapatılmadı.'
    end
  );

  return v_paid_card;
end;
$$;

revoke execute on function public.pay_card_debt(uuid, uuid, numeric) from public;
revoke execute on function public.pay_card_debt(uuid, uuid, numeric) from anon;
grant execute on function public.pay_card_debt(uuid, uuid, numeric) to authenticated;
