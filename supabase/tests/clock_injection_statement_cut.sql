-- Saat enjeksiyonu (app.today GUC) + Şubat/kesim=31 kenarı.
--
-- today_ist artık test edilebilir "bugün"dür: GUC yokken Istanbul günü
-- (üretim davranışı), set edilince o gün. Bu test iki şeyi kanıtlar:
--  1) GUC yokken today_ist == current_date (üretim yolunda sapma yok).
--  2) Şubat'ta statement_day=31 kartın kesimi ay sonuna KIRPILIR ve sınır
--     geçilmeden kesim olmaz (TS ikizi getCardStatementPeriod ile aynı takvim).
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  if private.today_ist() is distinct from current_date then
    raise exception 'BAŞARISIZ: GUC yokken today_ist (%) current_date (%) ile aynı değil.', private.today_ist(), current_date;
  end if;
end $$;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_archive record;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, debt_amount, statement_debt_amount, current_period_spending, provision_amount, statement_day, due_day, credit_limit)
  values (v_user, 'Saat Bankası', 'Şubat 31 Testi', 'kredi_karti', 500, 0, 500, 0, 31, 10, 50000)
  returning id into v_card;

  -- Kesim kuralı "sınırın ERTESİ günü BİR ÖNCEKİ dönemi kapatır": 15 Şubat'ta
  -- bakılan sınır 31 Ocak'tır. Ocak'ı önceden-kesilmiş işaretleyerek (ay başına
  -- tek arşiv idempotensi) sahneyi Şubat sınırına kuruyoruz.
  insert into public.card_statement_archives (user_id, card_id, statement_date, due_date, statement_debt_amount, period_year, period_month, status, paid_at)
  values (v_user, v_card, '2027-01-31', '2027-02-10', 0, 2027, 1, 'paid', '2027-02-05');

  -- 15 Şubat: Ocak zaten kesilmiş; Şubat sınırı (28'e kırpılmış 31) HENÜZ
  -- geçilmedi → yeni kesim olmamalı.
  perform set_config('app.today', '2027-02-15', true);
  perform public.cut_due_card_statements();
  if (select count(*) from public.card_statement_archives where card_id = v_card) <> 1 then
    raise exception 'BAŞARISIZ: sınır geçilmeden ekstre kesildi.';
  end if;

  -- 1 Mart: kırpılmış sınır (28 Şubat) geçildi → Şubat ekstresi kesilir,
  -- kesim tarihi ayın son gününe kırpılmış olmalı (2027-02-28).
  perform set_config('app.today', '2027-03-01', true);
  perform public.cut_due_card_statements();

  -- created_at aynı transaction'da eşit kalır; en yeni dönem period ile seçilir.
  select * into v_archive
  from public.card_statement_archives
  where card_id = v_card
  order by period_year desc, period_month desc limit 1;

  if v_archive is null then
    raise exception 'BAŞARISIZ: sınır geçti ama ekstre kesilmedi.';
  end if;
  if v_archive.statement_date <> date '2027-02-28' then
    raise exception 'BAŞARISIZ: kesim tarihi Şubat sonuna kırpılmadı (%).', v_archive.statement_date;
  end if;
  if v_archive.period_year <> 2027 or v_archive.period_month <> 2 then
    raise exception 'BAŞARISIZ: dönem 2027-02 değil (%-%).', v_archive.period_year, v_archive.period_month;
  end if;
  if v_archive.statement_debt_amount <> 500 then
    raise exception 'BAŞARISIZ: ekstre tutarı dönem içi kovayı almadı (%).', v_archive.statement_debt_amount;
  end if;

  -- GUC transaction-local: rollback sonrası hiçbir iz kalmaz.
  raise notice 'clock_injection_statement_cut: tüm kontroller geçti';
end $$;

rollback;
