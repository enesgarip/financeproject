-- Faz BM-3: Ödemeyi banka modeline indir.
--
-- B1 — Tam güncel ödemenin kuruş-eşitlik kilidi kaldırıldı. Kovayı satırsız
--   oynatan MEŞRU yollar var (import "banka toplamına kilit" düzeltmesi, iade
--   satırı, otomatik ödeme tutar düzeltmesi, kısmi aggregate ödeme); bunlardan
--   biri yaşandıysa sonraki tam ödeme deterministik olarak "hareket dağılımı
--   uyuşmuyor" hatasına takılıyordu. Banka modeli: ödeme toplamdan düşer,
--   satır dağılımı en-iyi-çabadır. Yeni kural: tüm allocation'sız satırlar bu
--   ödemeyle kapatılır; kova-satır farkı auditable residual olarak settlement
--   notuna ve bir correction history kaydına yazılır. Kova 0'a iner, satırlar
--   kanıta bağlanır — tutarlılık her tam ödemede kendini onarır. Daha iyi
--   provenance veren historical_repair yolu önce denenmeye devam eder.
--
-- B4 — p_skip_source_debit: kullanıcı bankada ödemeyi yaptığında hesap SMS'i
--   bakiyeyi ZATEN düşürdüyse, uygulamadaki ödeme kaydı bakiyeyi ikinci kez
--   düşürmemeli. Bayrak true gelirse kaynak hesap doğrulanır ama borçlandırma
--   yapılmaz; ödeme kaydı/settlement/arşiv kapanışı aynen işler ve not bunu
--   söyler. UI bu bayrağı yalnız aynı hesapta yakın tarihli aynı tutarlı SMS
--   hareketi bulduğunda önerir.

drop function if exists public.pay_card_debt(uuid, uuid, numeric);

create or replace function public.pay_card_debt(
  p_card_id uuid,
  p_source_card_id uuid,
  p_amount numeric,
  p_skip_source_debit boolean default false
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
  v_residual numeric(14, 2) := 0;
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

    -- B1: Sert eşitlik reddi yok. Kova-satır farkı (satırsız kova oynatan
    -- meşru yollardan kalan) residual olarak kapatılır: tüm allocation'sız
    -- satırlar bu ödemenin settlement'ına bağlanır, fark denetlenebilir
    -- şekilde kaydedilir. Pozitif residual = satırsız kova artışı da bu
    -- ödemeyle kapandı; negatif = satır toplamı kovadan büyüktü (ör. satırsız
    -- iade düzeltmesi) ve satırlar yine tek kanıta bağlandı.
    v_residual := round(v_card.current_period_spending - (v_single_total + v_installment_total), 2);
  end if;

  if p_skip_source_debit then
    -- B4: Bakiye banka/SMS tarafından zaten düşülmüş; yalnız doğrula, düşme.
    select *
    into v_source
    from public.cards
    where id = p_source_card_id
      and user_id = v_user_id
      and card_type = 'banka_karti'
    for update;

    if not found then
      raise exception 'Kaynak banka hesabı bulunamadı.';
    end if;
  else
    v_source := private.debit_bank_account(p_source_card_id, v_amount);
  end if;

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
      case
        when v_residual = 0 then 'Ekstre kesilmeden güncel borcun tamamı ödendi.'
        else format(
          'Ekstre kesilmeden güncel borcun tamamı ödendi. Kova-satır farkı (%s TL) residual olarak bu ödemeyle kapatıldı.',
          v_residual
        )
      end,
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

    if v_residual <> 0 then
      insert into public.transaction_history (
        user_id, type, title, amount, source_table, source_id, note
      ) values (
        v_user_id,
        'correction',
        v_card.card_name || ' kova-satır farkı ödemeyle kapatıldı',
        abs(v_residual),
        'card_current_settlements',
        v_settlement.id,
        format(
          'Tam güncel ödeme sırasında kova ile hareket toplamı arasında %s TL fark vardı (satırsız düzeltme/iade/kısmi ödeme kalıntısı). Fark bu ödemenin settlement kaydına bağlandı; ek nakit hareketi yok.',
          v_residual
        )
      );
    end if;
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
    v_source.card_name || case
      when p_skip_source_debit
      then ' hesabındaki bakiye banka/SMS hareketiyle zaten düşülmüştü; tekrar düşülmedi. '
      else ' hesabından ödendi. '
    end || case
      when v_is_full_current_settlement
      then 'Dönem içi hareketler ve vadesi gelmiş taksitler erken kapatıldı.'
      else 'Gelecek kredi kartı taksitleri kapatılmadı.'
    end
  );

  return v_paid_card;
end;
$$;

revoke execute on function public.pay_card_debt(uuid, uuid, numeric, boolean) from public;
revoke execute on function public.pay_card_debt(uuid, uuid, numeric, boolean) from anon;
grant execute on function public.pay_card_debt(uuid, uuid, numeric, boolean) to authenticated;

-- ── pay_card_statement: aynı B4 bayrağı ─────────────────────────────────────

drop function if exists public.pay_card_statement(uuid, uuid);

create or replace function public.pay_card_statement(
  p_statement_id uuid,
  p_source_card_id uuid,
  p_skip_source_debit boolean default false
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

  if p_skip_source_debit then
    -- B4: Bakiye banka/SMS tarafından zaten düşülmüş; yalnız doğrula, düşme.
    select *
    into v_source
    from public.cards
    where id = p_source_card_id
      and user_id = v_user_id
      and card_type = 'banka_karti'
    for update;

    if not found then
      raise exception 'Kaynak banka hesabı bulunamadı.';
    end if;
  else
    -- Kaynak hesap hareketi ekstre arşivindeki banka tutarıyla yapılır. Kartın
    -- geçici aggregate drift'i ödemeyi engellemez.
    v_source := private.debit_bank_account(p_source_card_id, v_payment_amount);
  end if;

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
    v_source.card_name || case
      when p_skip_source_debit
      then ' hesabındaki bakiye banka/SMS hareketiyle zaten düşülmüştü; tekrar düşülmedi. Taksit planı değiştirilmedi.'
      else ' hesabından ödendi. Taksit planı değiştirilmedi.'
    end
  );

  return v_paid_statement;
end;
$$;

revoke execute on function public.pay_card_statement(uuid, uuid, boolean) from public;
revoke execute on function public.pay_card_statement(uuid, uuid, boolean) from anon;
grant execute on function public.pay_card_statement(uuid, uuid, boolean) to authenticated;
