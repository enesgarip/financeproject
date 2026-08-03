-- SI-05 regresyonu: ekstre importunun taksit satırlarını doğru kurduğunu gerçek
-- RPC'ler üzerinden doğrular. Plancı (resolveStatementImportAction) bu üç aksiyona
-- çözer; burada aksiyonların DB etkisi kontrol edilir.
--
-- İnvariant (docs/CARD_DEBT_TRANSITIONS.md): kredi kartı borcu = ödenmemiş
-- (paid_at IS NULL) taksitlerin toplamı. Plan-ortası devirde geçmiş taksitler
-- paid_at ile işaretlenip borçtan hariç tutulur (status='paid' DEĞİL; 'posted'/
-- 'scheduled' + paid_at dolu). Beklentiler iş kuralından türetilir, util'den değil.
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

  -- ── Senaryo B — plan-ortası (4/12): plancı 'carryover' (paid=3, next=2026-08-19)
  -- İlk 3 taksit ödenmiş sayılır; borç yalnız kalan 9 × 1000 = 9000.
  insert into public.cards (user_id, bank_name, card_name, card_type, credit_limit, statement_day, due_day)
  values (v_user, 'SI', 'SI plan-ortasi', 'kredi_karti', 50000, 25, 10) returning id into v_card;
  perform public.record_card_installment_carryover(v_card, 'SI TAKSIT B', 1000, 12, 3, '2026-08-19', 'Market', 'si-B');

  select count(*),
         count(*) filter (where paid_at is not null),
         count(*) filter (where paid_at is null)
    into v_count, v_paid, v_unpaid
    from public.card_installments where card_id = v_card;
  if v_count <> 12 or v_paid <> 3 or v_unpaid <> 9 then
    raise exception 'FAIL B ayrim: 12/3/9 bekleniyordu, %/%/%', v_count, v_paid, v_unpaid;
  end if;
  -- Ödenmiş olanlar EN ERKEN taksitler (no 1..3) olmalı.
  if exists (select 1 from public.card_installments where card_id = v_card and paid_at is not null and installment_no > 3) then
    raise exception 'FAIL B odenmis sira: yalnizca ilk 3 taksit odenmis olmali';
  end if;
  -- Kalanların en erken vadesi devrin başlangıcı (2026-08-19).
  select min(due_month) into v_min from public.card_installments where card_id = v_card and paid_at is null;
  if v_min <> date '2026-08-19' then raise exception 'FAIL B kalan vade: 2026-08-19 bekleniyordu, %', v_min; end if;

  -- İNVARIANT: borç = ödenmemiş taksit toplamı; ödenmiş 3000 hariç.
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
  if v_count <> 12 or v_paid <> 11 or v_unpaid <> 1 then
    raise exception 'FAIL C ayrim: 12/11/1 bekleniyordu, %/%/%', v_count, v_paid, v_unpaid;
  end if;
  select min(due_month) into v_min from public.card_installments where card_id = v_card and paid_at is null;
  select debt_amount into v_debt from public.cards where id = v_card;
  if v_min <> date '2026-07-31' then raise exception 'FAIL C kalan vade: 2026-07-31 bekleniyordu, %', v_min; end if;
  if v_debt <> 250 then raise exception 'FAIL C borc: 250 bekleniyordu, %', v_debt; end if;

  raise notice 'Ekstre taksit import regresyonu OK (1. taksit / plan-ortasi / son taksit).';
end $$;

rollback;
