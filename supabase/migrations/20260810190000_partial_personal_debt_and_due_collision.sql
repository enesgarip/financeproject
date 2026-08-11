-- Faz BM-8: Uyuyan-akış denetiminin kalan correctness kalemleri.
--
-- D-1 — Kişisel borç/alacakta KISMİ ödeme. Eski settle_personal_debt tutar
--   parametresi almıyordu; "yarısını ödedim" gerçek senaryosunun karşılığı yoktu
--   (kullanıcı kaydı elle ikiye bölmek zorundaydı). Yeni imza opsiyonel p_amount
--   alır: null/tam değer → kapatır (eski davranış); 0 < p_amount < değer →
--   estimated_value_try ve amount'u oransal düşürür, kaydı açık bırakır ve nakiti
--   yalnız ödenen kadar oynatır. auto_valued kayıtta amount (birim miktar) da
--   oransal düşürülür ki sonraki değerleme senkronu tutarlı kalsın.
--
-- 2d — cut_card_statement son ödeme günü kesim gününe çakışırsa bir ay ötelenir.
--   TS ikizi getCardStatementPeriod bu düzeltmeyi içeriyordu (due_day <=
--   statement_day iken +1 ay); DB kesimi içermiyordu → statement_day=30,
--   due_day=31 gibi kartta arşiv due_date = statement_date çıkıp UI projeksiyonu
--   ile ıraksıyordu. Artık ikisi de aynı kuralı uygular (PDF importu p_due_date
--   verdiğinde o yine otoritedir).

drop function if exists public.settle_personal_debt(uuid, uuid);

create or replace function public.settle_personal_debt(
  p_debt_id uuid,
  p_account_card_id uuid,
  p_amount numeric default null
)
returns public.debts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_debt public.debts%rowtype;
  v_result public.debts%rowtype;
  v_account public.cards%rowtype;
  v_value numeric(14, 2);
  v_pay numeric(14, 2);
  v_is_partial boolean;
  v_ratio numeric;
  v_next_amount numeric;
  v_next_value numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_debt
  from public.debts
  where id = p_debt_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Borc kaydi bulunamadi.';
  end if;

  if v_debt.status <> 'açık' then
    raise exception 'Bu borc kaydi acik durumda degil.';
  end if;

  v_value := round(v_debt.estimated_value_try, 2);
  if v_value <= 0 then
    raise exception 'Borc tutari 0 dan buyuk olmali.';
  end if;

  -- p_amount null veya >= toplam değer → tam kapama. Aksi halde kısmi.
  v_pay := case
    when p_amount is null then v_value
    else round(p_amount, 2)
  end;

  if v_pay <= 0 then
    raise exception 'Odeme tutari 0 dan buyuk olmali.';
  end if;
  if v_pay > v_value then
    raise exception 'Odeme tutari borc/alacak degerinden buyuk olamaz.';
  end if;

  v_is_partial := v_pay < v_value;

  -- Nakit hareketi: borç aldımsa hesaptan düşer, verdiysem hesaba tahsil.
  if v_debt.direction = 'borç_aldım' then
    v_account := private.debit_bank_account(p_account_card_id, v_pay);
  else
    v_account := private.credit_bank_account(p_account_card_id, v_pay);
  end if;

  if v_is_partial then
    -- Değer ve birim miktar aynı oranda düşer; auto_valued kayıtta sonraki
    -- değerleme senkronu azaltılmış miktardan tutarlı yeniden hesaplar.
    v_next_value := round(v_value - v_pay, 2);
    v_ratio := v_next_value / v_value;
    v_next_amount := round(coalesce(v_debt.amount, 0) * v_ratio, 4);

    update public.debts
    set estimated_value_try = v_next_value,
        amount = v_next_amount,
        updated_at = now()
    where id = v_debt.id
    returning * into v_result;
  else
    update public.debts
    set status = 'kapandı',
        updated_at = now()
    where id = v_debt.id
    returning * into v_result;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'debt',
    v_debt.person_name || case
      when v_is_partial then ' borç kaydına kısmi ödeme'
      else ' borç kaydı kapandı'
    end,
    v_pay,
    'debts',
    v_debt.id,
    case
      when v_debt.direction = 'borç_aldım' then v_account.card_name || ' hesabından ödendi.'
      else v_account.card_name || ' hesabına tahsil edildi.'
    end || case
      when v_is_partial then ' Kalan değer: ' || v_next_value::text || ' TL.'
      else ''
    end
  );

  return v_result;
end;
$$;

revoke execute on function public.settle_personal_debt(uuid, uuid, numeric) from public;
revoke execute on function public.settle_personal_debt(uuid, uuid, numeric) from anon;
grant execute on function public.settle_personal_debt(uuid, uuid, numeric) to authenticated;

-- ── 2d: cut_card_statement due_date çakışma ötelemesi ────────────────────────
-- 20260810120000 gövdesi; tek değişiklik due_date üretiminde due_day <=
-- statement_day iken vadeyi bir sonraki aya taşımak (TS getCardStatementPeriod
-- ile hizalı). p_due_date verildiğinde o yine ezer.

drop function if exists public.cut_card_statement(uuid, date, date);

create or replace function public.cut_card_statement(
  p_card_id uuid,
  p_statement_date date default null,
  p_due_date date default null
)
returns public.card_statement_archives
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_archive public.card_statement_archives%rowtype;
  v_statement_amount numeric(14, 2);
  v_due_month_start date;
  v_due_date date;
  v_due_day integer;
  v_period_year integer;
  v_period_month integer;
  v_boundary date;
  v_this_boundary date;
  v_prev_month_start date;
  v_next_period_spending numeric(14, 2) := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstre kesilecek kredi kartı bulunamadı.';
  end if;

  if v_card.statement_day is not null then
    v_this_boundary := make_date(
      extract(year from current_date)::integer,
      extract(month from current_date)::integer,
      least(
        v_card.statement_day,
        extract(day from (date_trunc('month', current_date)::date + interval '1 month - 1 day'))::integer
      )
    );
    if current_date > v_this_boundary then
      v_boundary := v_this_boundary;
    else
      v_prev_month_start := (date_trunc('month', current_date) - interval '1 month')::date;
      v_boundary := make_date(
        extract(year from v_prev_month_start)::integer,
        extract(month from v_prev_month_start)::integer,
        least(
          v_card.statement_day,
          extract(day from (v_prev_month_start + interval '1 month - 1 day'))::integer
        )
      );
    end if;
  else
    v_boundary := current_date;
  end if;

  if p_statement_date is not null then
    if abs(p_statement_date - v_boundary) > 7 then
      raise exception 'PDF kesim tarihi (%) kartın ekstre takviminden (%) 7 günden fazla sapıyor; kartın kesim gününü kontrol et.',
        p_statement_date, v_boundary;
    end if;
    v_boundary := p_statement_date;
  end if;

  v_period_year := extract(year from v_boundary)::integer;
  v_period_month := extract(month from v_boundary)::integer;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_card.id::text || ':' || v_period_year::text || ':' || v_period_month::text, 0)
  );

  select *
  into v_archive
  from public.card_statement_archives
  where user_id = v_user_id
    and card_id = v_card.id
    and period_year = v_period_year
    and period_month = v_period_month
  order by created_at desc
  limit 1;

  if found then
    return v_archive;
  end if;

  if v_card.current_period_spending <= 0 then
    raise exception 'Dönem içi harcama olmadığı için kesilecek ekstre yok.';
  end if;

  select coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_expenses
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and current_settlement_id is null
    and installment_count <= 1
    and spent_at > v_boundary;

  select v_next_period_spending + coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_installments
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month > v_boundary;

  v_statement_amount := greatest(0, v_card.current_period_spending - v_next_period_spending);

  if v_statement_amount <= 0 then
    raise exception 'Dönem içi harcama olmadığı için kesilecek ekstre yok.';
  end if;

  if v_card.due_day is not null then
    v_due_month_start := date_trunc('month', v_boundary)::date;
    -- 2d: vade günü kesim gününe eşit/önce ise vadeyi bir sonraki aya taşı,
    -- yoksa arşiv due_date = statement_date çakışır (TS ikizi ile hizalı).
    if v_card.statement_day is not null and v_card.due_day <= v_card.statement_day then
      v_due_month_start := (v_due_month_start + interval '1 month')::date;
    end if;
    v_due_day := least(
      v_card.due_day,
      extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer
    );
    v_due_date := v_due_month_start + (v_due_day - 1);
  end if;

  if p_due_date is not null then
    if p_due_date <= v_boundary or p_due_date - v_boundary > 45 then
      raise exception 'PDF son ödeme tarihi (%) kesim tarihine (%) göre geçersiz.',
        p_due_date, v_boundary;
    end if;
    v_due_date := p_due_date;
  end if;

  insert into public.card_statement_archives (
    user_id, card_id, period_year, period_month, statement_date, due_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status, note
  )
  values (
    v_user_id, v_card.id, v_period_year, v_period_month, v_boundary, v_due_date,
    v_statement_amount, v_statement_amount, v_card.debt_amount, 'open',
    v_card.card_name || ' ekstresi kesildi.'
  )
  returning * into v_archive;

  perform set_config('app.card_statement_allocation_user_id', v_user_id::text, true);

  update public.card_expenses
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and current_settlement_id is null
    and installment_count <= 1
    and spent_at <= v_boundary;

  update public.card_installments
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month <= v_boundary;

  perform set_config('app.card_statement_allocation_user_id', '', true);

  update public.cards
  set statement_debt_amount = statement_debt_amount + v_statement_amount,
      current_period_spending = v_next_period_spending,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id, 'card', v_card.card_name || ' ekstresi kesildi', v_statement_amount,
    'card_statement_archives', v_archive.id,
    'Dönem borcu ekstreye aktarıldı. Erken kapatılmış hareketler ve vadesi gelmemiş taksitler dışarıda bırakıldı.'
  );

  return v_archive;
end;
$$;

revoke execute on function public.cut_card_statement(uuid, date, date) from public;
revoke execute on function public.cut_card_statement(uuid, date, date) from anon;
grant execute on function public.cut_card_statement(uuid, date, date) to authenticated;
