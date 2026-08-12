-- Denetim 2026-08-12 Faz F (kalan ORTA bulgular) — DB tarafi.
--
-- 1) update_card_expense: banka karti yolunda BAYAT bakiye kontrolu.
--    Eski tutar bakiyeye iade edildikten SONRA kontrol v_card.current_balance
--    (iade ONCESI snapshot) ile yapiliyordu -> mesru duzenlemeler yanlis yere
--    reddediliyordu. Senaryo: bakiye 0, eski harcama 100 TL, yeni tutar 50 TL;
--    iade sonrasi 100 TL var ama fonksiyon 'Banka karti bakiyesi yetersiz' der.
--    Govde 20260810120000'deki SON tanimin birebir kopyasidir; tek fark bu
--    kontrolun iade sonrasi degeri kullanmasi (K3 dersi: eski migration'dan
--    turetme, son tanimi taban al).
--
-- 2) reset_card_import_data: 20260805120000 yeniden tanimi, 20260802190000'de
--    eklenen iki anlamli on-kosul mesajini dusurmustu. Veri hala guvende
--    (guard trigger DELETE'i bloklar) ama kullanici jenerik trigger hatasi
--    goruyordu. Govde 20260805120000 (provizyon koruma) tabani + iki on-kosul.

create or replace function public.update_card_expense(
  p_expense_id uuid,
  p_amount numeric,
  p_description text,
  p_spent_at date default null,
  p_installment_count integer default null,
  p_category text default null,
  p_note text default null
)
returns public.card_expenses
language plpgsql
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_initial_card_id uuid;
  v_expense public.card_expenses%rowtype;
  v_card public.cards%rowtype;
  v_installment_count integer;
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_spent_at date;
  v_category text;
  v_posted_period_amount numeric(14, 2) := 0;
  v_paid_before integer := 0;
  v_start_installment_no integer := 1;
  v_current_period_amount numeric(14, 2) := 0;
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

  -- Statement cutting locks card -> children. Use the same order here to avoid
  -- a child -> card / card -> child deadlock. Re-read the expense under lock
  -- after locking the card because the first lookup is intentionally unlocked.
  select card_id
  into v_initial_card_id
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Harcama bulunamadi.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_initial_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
    and card_id = v_card.id
  for update;

  if not found then
    raise exception 'Harcama bulunamadi veya karti degisti; yeniden deneyin.';
  end if;

  if v_expense.status <> 'posted' then
    raise exception 'Sadece kesinlesmis harcamalar duzenlenebilir.';
  end if;

  -- cut_card_statement locks this same card before allocating children. Check
  -- only after that lock so a concurrent cut cannot attach an installment
  -- between this decision and the edit's child-row rebuild.
  if v_expense.statement_archive_id is not null
     or exists (
       select 1
       from public.card_installments installment
       where installment.card_expense_id = v_expense.id
         and installment.statement_archive_id is not null
     ) then
    raise exception 'Ekstreye kesilmis kart harcamasi duzenlenemez.';
  end if;

  v_installment_count := greatest(1, least(coalesce(p_installment_count, v_expense.installment_count), 36));
  v_spent_at := coalesce(p_spent_at, v_expense.spent_at);
  v_category := coalesce(nullif(btrim(coalesce(p_category, '')), ''), v_expense.category);

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

  -- Devreden plan notu geçmiş taksit sayısını taşır; iki format da tanınır.
  -- Eski RPC: "N/M taksiti uygulama öncesinde ödendi."
  -- 20260809190000: "N/M taksit ekstre öncesinde tamamlandı; yalnız açık plan tutulur."
  -- Tanınmazsa düzenleme geçmiş taksitleri sıfır sayıp planı 1..M yeniden kurar.
  if v_expense.note ~ '^[0-9]+/[0-9]+ taksiti uygulama [oö]ncesinde [oö]dendi\.$' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksiti uygulama [oö]ncesinde [oö]dendi\.$'))[1]::integer
    ));
    v_start_installment_no := v_paid_before + 1;
  elsif v_expense.note ~ '^[0-9]+/[0-9]+ taksit ekstre [oö]ncesinde tamamland[iı]' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksit ekstre [oö]ncesinde tamamland[iı]'))[1]::integer
    ));
    v_start_installment_no := v_paid_before + 1;
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_card.card_type = 'kredi_karti' then
    select coalesce(sum(amount), 0)
    into v_posted_period_amount
    from public.card_installments
    where card_expense_id = v_expense.id
      and status = 'posted';

    if v_posted_period_amount = 0 then
      v_posted_period_amount := case
        when v_expense.installment_count <= 1 then v_expense.amount
        else v_expense.installment_amount
      end;
    end if;

    update public.cards
    set debt_amount = greatest(0, debt_amount - v_expense.amount),
        current_period_spending = greatest(0, current_period_spending - v_posted_period_amount),
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance + v_expense.amount,
        updated_at = now()
    where id = v_card.id;

    -- Bakiye kontrolu IADE SONRASI degeri kullanmali: v_card iade oncesi
    -- okundu, guncel bakiye v_card.current_balance + v_expense.amount.
    -- Eskisi yanlis red uretiyordu (bakiye 0, eski 100, yeni 50 -> hata).
    if v_card.current_balance + v_expense.amount < p_amount then
      raise exception 'Banka karti bakiyesi yetersiz.';
    end if;
  end if;

  delete from public.card_installments
  where card_expense_id = v_expense.id;

  update public.card_expenses
  set spent_at = v_spent_at,
      amount = p_amount,
      description = btrim(coalesce(p_description, '')),
      category = v_category,
      installment_count = v_installment_count,
      installment_amount = v_first_installment_amount,
      note = coalesce(p_note, v_expense.note),
      updated_at = now()
  where id = v_expense.id
  returning * into v_expense;

  if v_card.card_type = 'kredi_karti' then
    if v_installment_count > 1 then
      for v_installment_no in v_start_installment_no..v_installment_count loop
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

    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + v_current_period_amount,
        updated_at = now()
    where id = v_card.id;

    if v_installment_count > 1 then
      for v_installment_no in v_start_installment_no..v_installment_count loop
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
          v_card.id,
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
  else
    update public.cards
    set current_balance = current_balance - p_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  return v_expense;
end;
$function$;

grant execute on function public.update_card_expense(uuid, numeric, text, date, integer, text, text) to authenticated;

-- ── 2) reset_card_import_data: dusen on-kosul mesajlari geri ────────────────
-- Govde 20260805120000'in (provizyon koruma) birebir kopyasi; tek fark
-- 20260802190000'de eklenip sonra kaybolan iki on-kosul kontrolu.

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

  -- On-kosullar: erken odeme gecmisi ya da odenmis ekstreye bagli taksit varsa
  -- temiz ice aktarim kaydi yeniden kuramaz. Guard trigger'lar DELETE'i zaten
  -- bloklar; bu kontroller kullaniciya JENERIK trigger hatasi yerine ne
  -- yapmasi gerektigini soyleyen mesaji verir (silme oncesi basarisiz ol).
  if exists (
    select 1
    from public.card_expenses expense
    where expense.user_id = v_user_id
      and expense.card_id = p_card_id
      and expense.current_settlement_id is not null
  ) or exists (
    select 1
    from public.card_installments installment
    where installment.user_id = v_user_id
      and installment.card_id = p_card_id
      and installment.current_settlement_id is not null
  ) then
    raise exception 'Erken ödeme geçmişi bulunan kart temiz içe aktarımla sıfırlanamaz.';
  end if;

  if exists (
    select 1
    from public.card_installments installment
    join public.card_statement_archives archive
      on archive.id = installment.statement_archive_id
    where installment.user_id = v_user_id
      and installment.card_id = p_card_id
      and coalesce(archive.status, 'open') = 'paid'
  ) then
    raise exception 'Ödenmiş ekstreye bağlı taksit geçmişi temiz içe aktarımla yeniden kurulamaz.';
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

grant execute on function public.reset_card_import_data(uuid) to authenticated;
