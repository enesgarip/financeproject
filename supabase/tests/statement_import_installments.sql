-- SI-05 regresyonu: ekstre importunun taksit satırlarını doğru kurduğunu gerçek
-- RPC'ler üzerinden doğrular. Plancı (resolveStatementImportAction) bu üç aksiyona
-- çözer; burada aksiyonların DB etkisi kontrol edilir.
--
-- İnvariant (docs/CARD_DEBT_TRANSITIONS.md): devreden/PDF kaynaklı bir plan yalnız
-- cari ve gelecek açık taksitleri tutar. Geçmiş taksitler sentetik paid satırlar
-- olarak yeniden yaratılmaz; ödenen şey taksit değil ekstre arşividir.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_count integer;
  v_paid integer;
  v_unpaid integer;
  v_debt numeric;
  v_sum numeric;
  v_min date;
  v_max date;
  v_parent uuid;
  v_paid_archive uuid;
  v_statement_date date;
  v_open_archive_count integer;
  v_original_expense uuid;
  v_new_parent uuid;
  v_failed boolean;
begin
  -- ── Senaryo A — 1. taksit: plancı 'expense' (toplam tutar + adet, orijinal tarih)
  -- 12 × 1000 = 12000, 2026-05-19 başlangıç. Yeni plan → hiçbir taksit ödenmemiş.
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_user, 'SI', 'SI 1. taksit', 'kredi_karti', 50000, 25, 10) returning id into v_card;
  perform public.add_card_expense(v_card, 12000, 'SI TAKSIT A', '2026-05-19', 12, 'Market', 'posted', null, 'statement_import', 'si-A');

  select count(*), coalesce(sum(amount), 0),
         count(*) filter (where paid_at is not null),
         min(due_month), max(due_month)
    into v_count, v_sum, v_paid, v_min, v_max
    from public.card_installments where card_id = v_card;
  if v_count <> 12 then raise exception 'FAIL A adet: 12 bekleniyordu, %', v_count; end if;
  if v_sum <> 12000 then raise exception 'FAIL A toplam: 12000 bekleniyordu, %', v_sum; end if;
  if v_paid <> 0 then raise exception 'FAIL A odenmis: 0 bekleniyordu (yeni plan), %', v_paid; end if;
  if v_min <> date '2026-05-19' or v_max <> date '2027-04-19' then
    raise exception 'FAIL A tarih araligi: 2026-05-19..2027-04-19 bekleniyordu, %..%', v_min, v_max;
  end if;
  if exists (select 1 from public.card_installments where card_id = v_card and amount <> 1000) then
    raise exception 'FAIL A aylik tutar: her taksit 1000 olmali';
  end if;
  select debt_amount into v_debt from public.cards where id = v_card;
  if v_debt <> 12000 then raise exception 'FAIL A borc: 12000 bekleniyordu, %', v_debt; end if;

  -- ── Senaryo B — plan-ortası (4/12): yalnız 4..12 açık plan olarak tutulur.
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_user, 'SI', 'SI plan-ortasi', 'kredi_karti', 50000, 25, 10) returning id into v_card;
  perform public.record_card_installment_carryover(v_card, 'SI TAKSIT B', 1000, 12, 3, '2026-08-19', 'Market', 'si-B');

  select count(*),
         count(*) filter (where paid_at is not null),
         count(*) filter (where paid_at is null)
    into v_count, v_paid, v_unpaid
    from public.card_installments where card_id = v_card;
  if v_count <> 9 or v_paid <> 0 or v_unpaid <> 9 then
    raise exception 'FAIL B ayrim: 9/0/9 bekleniyordu, %/%/%', v_count, v_paid, v_unpaid;
  end if;
  if exists (select 1 from public.card_installments where card_id = v_card and installment_no < 4) then
    raise exception 'FAIL B gecmis taksitler sentetik olarak yeniden yaratildi';
  end if;
  -- Kalanların en erken vadesi devrin başlangıcı (2026-08-19).
  select min(due_month) into v_min from public.card_installments where card_id = v_card and paid_at is null;
  if v_min <> date '2026-08-19' then raise exception 'FAIL B kalan vade: 2026-08-19 bekleniyordu, %', v_min; end if;

  -- İNVARIANT: borç = açık taksit toplamı.
  select debt_amount into v_debt from public.cards where id = v_card;
  select coalesce(sum(amount), 0) into v_sum from public.card_installments where card_id = v_card and paid_at is null;
  if v_debt <> 9000 then raise exception 'FAIL B borc: 9000 bekleniyordu, %', v_debt; end if;
  if v_debt <> v_sum then raise exception 'FAIL B invariant: borc(%) = odenmemis toplam(%) olmali', v_debt, v_sum; end if;

  -- ── Senaryo C — son taksit (12/12): plancı 'carryover' (paid=11, next=2026-07-31)
  -- Ay-sonu: orijinal 2025-08-31, 11 ay ileri son kalan = 2026-07-31. Borç = 250.
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_user, 'SI', 'SI son taksit', 'kredi_karti', 50000, 25, 10) returning id into v_card;
  perform public.record_card_installment_carryover(v_card, 'SI TAKSIT C', 250, 12, 11, '2026-07-31', 'Market', 'si-C');

  select count(*),
         count(*) filter (where paid_at is not null),
         count(*) filter (where paid_at is null)
    into v_count, v_paid, v_unpaid
    from public.card_installments where card_id = v_card;
  if v_count <> 1 or v_paid <> 0 or v_unpaid <> 1 then
    raise exception 'FAIL C ayrim: 1/0/1 bekleniyordu, %/%/%', v_count, v_paid, v_unpaid;
  end if;
  select min(due_month) into v_min from public.card_installments where card_id = v_card and paid_at is null;
  select debt_amount into v_debt from public.cards where id = v_card;
  if v_min <> date '2026-07-31' then raise exception 'FAIL C kalan vade: 2026-07-31 bekleniyordu, %', v_min; end if;
  if v_debt <> 250 then raise exception 'FAIL C borc: 250 bekleniyordu, %', v_debt; end if;

  -- ── Senaryo D — PDF açık dönemi atomik yeniden kurar; paid geçmiş ve PDF
  -- sonrası hareket kalır. Aynı payload ikinci kez çalışınca sonuç değişmez.
  v_statement_date := current_date - 1;
  insert into public.cards (
    user_id, bank_name, card_name, card_type, credit_limit, statement_day,
    debt_amount, statement_debt_amount, current_period_spending, provision_amount
  ) values (
    v_user, 'SI', 'SI PDF replace', 'kredi_karti', 50000,
    extract(day from v_statement_date)::integer, 0, 0, 0, 0
  ) returning id into v_card;

  insert into public.card_statement_archives (
    user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount,
    status, paid_at, note
  ) values (
    v_user, v_card,
    extract(year from (v_statement_date - interval '1 month'))::integer,
    extract(month from (v_statement_date - interval '1 month'))::integer,
    (v_statement_date - interval '1 month')::date,
    100, 100, 100, 'paid', now(), 'Korunacak geçmiş ekstre'
  ) returning id into v_paid_archive;

  insert into public.card_expenses (
    user_id, card_id, spent_at, amount, description, category,
    installment_count, status, posted_at, note
  ) values (
    v_user, v_card, (v_statement_date - interval '1 month')::date,
    450, 'PDF TAKSIT', 'Market', 4, 'posted', now(), 'Tarihsel parent toplamı korunmalı'
  ) returning id into v_parent;

  insert into public.card_installments (
    user_id, card_id, card_expense_id, statement_archive_id,
    installment_no, installment_count, due_month, amount, description,
    category, status, posted_at, paid_at, note
  ) values (
    v_user, v_card, v_parent, v_paid_archive,
    1, 4, (v_statement_date - interval '1 month')::date, 100, 'PDF TAKSIT',
    'Market', 'paid', now(), now(), 'Korunacak paid child'
  );

  insert into public.card_installments (
    user_id, card_id, card_expense_id, installment_no, installment_count,
    due_month, amount, description, category, status, posted_at
  ) values
    (v_user, v_card, v_parent, 2, 4, v_statement_date, 90, 'PDF TAKSIT', 'Market', 'posted', now()),
    (v_user, v_card, v_parent, 3, 4, (v_statement_date + interval '1 month')::date, 90, 'PDF TAKSIT', 'Market', 'scheduled', null),
    (v_user, v_card, v_parent, 4, 4, (v_statement_date + interval '2 month')::date, 90, 'PDF TAKSIT', 'Market', 'scheduled', null);

  perform public.add_card_expense(
    v_card, 50, 'PDF SONRASI', (v_statement_date + 1), 1, 'Diğer',
    'posted', null, 'sms', 'after-pdf'
  );
  perform public.add_card_expense(
    v_card, 30, 'PDF SONRASI PROVIZYON', (v_statement_date + 1), 1, 'Diğer',
    'provision', null, 'sms', 'after-pdf-provision'
  );
  update public.cards
  set debt_amount = 350,
      current_period_spending = 140,
      provision_amount = 30
  where id = v_card;

  perform public.replace_card_statement_import(
    v_card,
    v_statement_date,
    null,
    160,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'carryover',
        'installmentAmount', 100,
        'totalInstallments', 4,
        'paidInstallments', 1,
        'nextDueDate', v_statement_date,
        'description', 'PDF TAKSIT',
        'category', 'Market',
        'sourceEventId', 'pdf-replace:installment'
      ),
      jsonb_build_object(
        'kind', 'expense',
        'amount', 70,
        'spentAt', v_statement_date,
        'installmentCount', 1,
        'description', 'PDF MARKET',
        'category', 'Market',
        'sourceEventId', 'pdf-replace:expense'
      ),
      jsonb_build_object(
        'kind', 'adjustment', 'amount', 10,
        'spentAt', v_statement_date, 'description', 'PDF IADE',
        'sourceEventId', 'pdf-replace:refund'
      )
    )
  );

  select debt_amount into v_debt from public.cards where id = v_card;
  if v_debt <> 440 then raise exception 'FAIL D borc: 440 bekleniyordu, %', v_debt; end if;
  if (select statement_debt_amount from public.cards where id = v_card) <> 160 then
    raise exception 'FAIL D ekstre: 160 bekleniyordu';
  end if;
  if (select current_period_spending from public.cards where id = v_card) <> 50 then
    raise exception 'FAIL D PDF sonrasi current: 50 bekleniyordu';
  end if;
  if (select provision_amount from public.cards where id = v_card) <> 30 then
    raise exception 'FAIL D PDF sonrasi provizyon: 30 bekleniyordu';
  end if;
  if not exists (
    select 1 from public.card_expenses
    where card_id = v_card and source_event_id = 'after-pdf' and spent_at > v_statement_date
  ) then
    raise exception 'FAIL D PDF sonrasi hareket silindi';
  end if;
  if not exists (
    select 1 from public.card_installments
    where card_expense_id = v_parent and statement_archive_id = v_paid_archive and status = 'paid'
  ) then
    raise exception 'FAIL D paid geçmiş taksit korunmadı';
  end if;
  if (select amount from public.card_expenses where id = v_parent) <> 450 then
    raise exception 'FAIL D tarihsel parent toplamı değiştirildi';
  end if;
  select id into v_new_parent from public.card_expenses
  where card_id = v_card and source_event_id = 'pdf-replace:installment';
  select count(*) into v_count from public.card_installments where card_expense_id = v_parent;
  if v_count <> 1 then raise exception 'FAIL D tarihsel parent child adedi: 1 bekleniyordu, %', v_count; end if;
  select count(*) into v_count from public.card_installments where card_expense_id = v_new_parent;
  if v_count <> 3 then raise exception 'FAIL D yeni acik plan child adedi: 3 bekleniyordu, %', v_count; end if;

  perform public.replace_card_statement_import(
    v_card,
    v_statement_date,
    null,
    160,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'carryover', 'installmentAmount', 100,
        'totalInstallments', 4, 'paidInstallments', 1,
        'nextDueDate', v_statement_date, 'description', 'PDF TAKSIT',
        'category', 'Market', 'sourceEventId', 'pdf-replace:installment'
      ),
      jsonb_build_object(
        'kind', 'expense', 'amount', 70, 'spentAt', v_statement_date,
        'installmentCount', 1, 'description', 'PDF MARKET',
        'category', 'Market', 'sourceEventId', 'pdf-replace:expense'
      ),
      jsonb_build_object(
        'kind', 'adjustment', 'amount', 10,
        'spentAt', v_statement_date, 'description', 'PDF IADE',
        'sourceEventId', 'pdf-replace:refund'
      )
    )
  );

  select debt_amount into v_debt from public.cards where id = v_card;
  select count(*) into v_count
  from public.card_installments installment
  join public.card_expenses expense on expense.id = installment.card_expense_id
  where expense.card_id = v_card and expense.source_event_id = 'pdf-replace:installment';
  select count(*) into v_open_archive_count
  from public.card_statement_archives where card_id = v_card and status = 'open';
  if v_debt <> 440 or v_count <> 3 or v_open_archive_count <> 1 then
    raise exception 'FAIL D reimport idempotency: debt/child/open = %/%/%', v_debt, v_count, v_open_archive_count;
  end if;

  -- ── Senaryo E — kesim tarihi doğrulaması en sonda hata verse bile RPC'nin
  -- tüm temizleme/import adımları subtransaction ile geri alınır. K3 sonrası
  -- ±7 gün tolere edildiği için hatayı 9 günlük sapma tetikler; orijinal
  -- harcama silme kapsamına girsin diye PDF tarihinden önceye konur.
  insert into public.cards (
    user_id, bank_name, card_name, card_type, credit_limit, statement_day
  ) values (
    v_user, 'SI', 'SI rollback', 'kredi_karti', 50000,
    extract(day from (current_date - 1))::integer
  ) returning id into v_card;
  select id into v_original_expense
  from public.add_card_expense(
    v_card, 20, 'ROLLBACK ORIGINAL', (current_date - 12), 1, 'Diğer',
    'posted', null, 'manual', 'rollback-original'
  );

  v_failed := false;
  begin
    perform public.replace_card_statement_import(
      v_card,
      current_date - 10,
      null,
      30,
      jsonb_build_array(jsonb_build_object(
        'kind', 'expense', 'amount', 30, 'spentAt', current_date - 10,
        'installmentCount', 1, 'description', 'ROLLBACK NEW',
        'category', 'Diğer', 'sourceEventId', 'rollback-new'
      ))
    );
  exception when others then
    v_failed := true;
  end;

  if not v_failed then raise exception 'FAIL E tarih uyumsuzluğu hata vermedi'; end if;
  if not exists (select 1 from public.card_expenses where id = v_original_expense) then
    raise exception 'FAIL E atomik rollback orijinal harcamayı geri getirmedi';
  end if;
  select debt_amount into v_debt from public.cards where id = v_card;
  if v_debt <> 20 then raise exception 'FAIL E atomik rollback borcu: 20 bekleniyordu, %', v_debt; end if;

  -- ── Senaryo F — K2: ödenmiş dönemin (veya daha eskisinin) PDF'i yeniden
  -- import edilemez. Re-import borcu ikiye katlar ve açık taksitleri silerdi.
  insert into public.cards (
    user_id, bank_name, card_name, card_type, credit_limit, statement_day
  ) values (
    v_user, 'SI', 'SI paid reimport', 'kredi_karti', 50000,
    extract(day from v_statement_date)::integer
  ) returning id into v_card;

  insert into public.card_statement_archives (
    user_id, card_id, period_year, period_month, statement_date,
    statement_debt_amount, current_period_spending, total_debt_amount,
    status, paid_at, note
  ) values (
    v_user, v_card,
    extract(year from v_statement_date)::integer,
    extract(month from v_statement_date)::integer,
    v_statement_date, 200, 200, 200, 'paid', now(), 'Ödenmiş dönem'
  );

  -- Aynı dönemin PDF'i reddedilir.
  v_failed := false;
  begin
    perform public.replace_card_statement_import(
      v_card, v_statement_date, null, 200,
      jsonb_build_array(jsonb_build_object(
        'kind', 'expense', 'amount', 200, 'spentAt', v_statement_date,
        'installmentCount', 1, 'description', 'PAID REIMPORT',
        'category', 'Diğer', 'sourceEventId', 'paid-reimport'
      ))
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL F ödenmiş dönem re-importu reddedilmedi'; end if;

  -- Ödenmişten daha eski bir dönemin PDF'i de reddedilir (geriye dönük import).
  v_failed := false;
  begin
    perform public.replace_card_statement_import(
      v_card, (v_statement_date - interval '1 month')::date, null, 150,
      jsonb_build_array(jsonb_build_object(
        'kind', 'expense', 'amount', 150, 'spentAt', (v_statement_date - interval '1 month')::date,
        'installmentCount', 1, 'description', 'OLDER REIMPORT',
        'category', 'Diğer', 'sourceEventId', 'older-reimport'
      ))
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL F ödenmişten eski dönem importu reddedilmedi'; end if;

  if (select debt_amount from public.cards where id = v_card) <> 0 then
    raise exception 'FAIL F reddedilen import borç bıraktı';
  end if;

  -- ── Senaryo G — K3: PDF kesim/son ödeme tarihi ±7 gün içinde otoritedir.
  -- Kart takvimi kesimi current_date-3 hesaplar; PDF current_date-1 der (banka
  -- kaydırması). Import başarılı olmalı ve arşiv PDF tarihlerini taşımalı.
  insert into public.cards (
    user_id, bank_name, card_name, card_type, credit_limit, statement_day
  ) values (
    v_user, 'SI', 'SI banka tarihi', 'kredi_karti', 50000,
    extract(day from (current_date - 3))::integer
  ) returning id into v_card;

  perform public.replace_card_statement_import(
    v_card,
    current_date - 1,
    current_date + 9,
    100,
    jsonb_build_array(jsonb_build_object(
      'kind', 'expense', 'amount', 100, 'spentAt', current_date - 2,
      'installmentCount', 1, 'description', 'BANKA TARIHI',
      'category', 'Diğer', 'sourceEventId', 'bank-dates'
    ))
  );

  select statement_date, due_date into v_min, v_max
  from public.card_statement_archives
  where card_id = v_card and status = 'open';
  if v_min <> (current_date - 1) or v_max <> (current_date + 9) then
    raise exception 'FAIL G arşiv PDF tarihlerini taşımalı: %/% bekleniyordu, %/%',
      current_date - 1, current_date + 9, v_min, v_max;
  end if;
  if (select statement_debt_amount from public.cards where id = v_card) <> 100 then
    raise exception 'FAIL G ekstre kovası 100 olmalı';
  end if;

  raise notice 'Ekstre taksit import regresyonu OK (1. / orta / son / PDF açık plan yenileme / atomik rollback / paid re-import reddi / PDF tarih otoritesi).';
end $$;

rollback;
