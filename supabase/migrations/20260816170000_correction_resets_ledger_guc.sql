-- post_card_debt_correction, `app.ledger_kind` ve `app.ledger_note` GUC'larını
-- transaction-local ayarlıyor ama GERİ ALMIYORDU. Aynı transaction'da sonra
-- çalışan her kart yazımı (ör. cancel_card_expense) bu etiketi miras alıyor ve
-- ledger'a `credit` yerine `adjustment` + yabancı bir notla düşüyordu. Tutarlar
-- doğru kalıyor, DENETİM KAYDI yanlış oluyordu.
--
-- Uygulama transaction başına tek düzeltme yaptığı için bugüne dek görünmedi;
-- 2026-08-16'da toplu bir bakım script'inde ortaya çıktı. Diğer RPC'ler zaten
-- bu deseni uyguluyor (bkz. 20260802160000, 20260806120000): GUC kullanıldıktan
-- sonra boşa çekilir.
--
-- Fonksiyonun geri kalanı 20260621213000'deki sürümle BİREBİR aynıdır; yalnız
-- return öncesine iki set_config eklendi.

create or replace function public.post_card_debt_correction(
  p_card_id uuid,
  p_amount_kurus bigint,
  p_note text
)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_delta numeric(14, 2);
  v_new_debt numeric(14, 2);
  v_remaining numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount_kurus is null or p_amount_kurus = 0 then
    raise exception 'Duzeltme tutari 0 olamaz.';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'Duzeltme icin bir sebep girilmeli.';
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

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Sadece kredi karti borcu duzeltilebilir.';
  end if;

  v_delta := p_amount_kurus / 100.0;
  v_new_debt := coalesce(v_card.debt_amount, 0) + v_delta;
  if v_new_debt < 0 then
    raise exception 'Duzeltme sonrasi borc negatif olamaz.';
  end if;

  v_remaining := greatest(0, -v_delta);

  perform set_config('app.ledger_kind', 'adjustment', true);
  perform set_config('app.ledger_note', btrim(p_note), true);

  update public.cards
  set debt_amount = v_new_debt,
      current_period_spending = case
        when v_delta < 0 then greatest(0, current_period_spending - v_remaining)
        when v_delta > 0 then current_period_spending + v_delta
        else current_period_spending
      end,
      statement_debt_amount = case
        when v_delta < 0 then greatest(0, statement_debt_amount - greatest(0, v_remaining - current_period_spending))
        else statement_debt_amount
      end,
      provision_amount = case
        when v_delta < 0 then greatest(0, provision_amount - greatest(0, v_remaining - current_period_spending - statement_debt_amount))
        else provision_amount
      end,
      updated_at = now()
  where id = p_card_id;

  -- GUC'ları bırakmadan çık: bu transaction'da sonra yazılacak ledger olayları
  -- bu düzeltmenin etiketini/notunu miras almamalı.
  perform set_config('app.ledger_kind', '', true);
  perform set_config('app.ledger_note', '', true);

  return v_new_debt;
end;
$$;
