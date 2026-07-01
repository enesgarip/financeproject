-- SMS hesap hareketi eşleştirmesini toleranslı yap.
--
-- Sorun: record_sms_account_movement, SMS'ten gelen hesap numarasını
-- cards.account_number ile yalnız rakam-bazlı BİREBİR eşleştiriyordu.
-- Bankalar SMS'te numarayı şube kodu + hesap no + ek no (örn.
-- "4230-13300128-351") formatında gönderirken kullanıcı uygulamaya
-- numaranın bir kısmını (örn. "13300128-351") veya IBAN'ı girmiş
-- olabiliyor; bu durumda eşleşme bulunamıyor ve hareket kaydedilemiyordu.
--
-- Çözüm: önce birebir eşleşme denenir (mevcut davranış). Bulunamazsa
-- karşılıklı içerme ile toleranslı eşleşme yapılır: saklanan numara SMS
-- numarasının içinde geçiyorsa (kısmi numara girilmiş) veya SMS numarası
-- saklananın içinde geçiyorsa (IBAN girilmiş) eşleşir. Yanlış pozitifi
-- önlemek için kısa taraf en az 6 rakam olmalı; birden fazla hesap
-- eşleşirse işlem reddedilir ve netleştirme istenir.

create or replace function public.record_sms_account_movement(
  p_account_number text,
  p_amount numeric,
  p_direction text,
  p_counterparty text,
  p_occurred_at timestamptz default now(),
  p_transaction_type text default null,
  p_user_id uuid default null
)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := coalesce(p_user_id, (select auth.uid()));
  v_card public.cards%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_normalized_account text;
  v_match_count integer;
begin
  if p_direction not in ('in', 'out') then
    raise exception 'Gecersiz hareket yonu.';
  end if;

  if v_amount <= 0 then
    raise exception 'Tutar 0 dan buyuk olmali.';
  end if;

  v_normalized_account := regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g');

  if v_normalized_account = '' then
    raise exception 'Hesap numarasi bos olamaz.';
  end if;

  -- 1) Birebir eşleşme (mevcut davranış korunur).
  select *
  into v_card
  from public.cards
  where (v_user_id is null or user_id = v_user_id)
    and card_type = 'banka_karti'
    and regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g') = v_normalized_account
  for update;

  -- 2) Toleranslı eşleşme: karşılıklı içerme, kısa taraf >= 6 rakam.
  if not found then
    select count(*)
    into v_match_count
    from public.cards
    where (v_user_id is null or user_id = v_user_id)
      and card_type = 'banka_karti'
      and length(regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g')) >= 6
      and (
        position(regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g') in v_normalized_account) > 0
        or (
          length(v_normalized_account) >= 6
          and position(v_normalized_account in regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g')) > 0
        )
      );

    if v_match_count > 1 then
      raise exception 'Hesap numarasi "%" birden fazla banka hesabiyla eslesti. Kartlar sayfasinda hesap numaralarini tam ve benzersiz yaz.', p_account_number;
    end if;

    if v_match_count = 1 then
      select *
      into v_card
      from public.cards
      where (v_user_id is null or user_id = v_user_id)
        and card_type = 'banka_karti'
        and length(regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g')) >= 6
        and (
          position(regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g') in v_normalized_account) > 0
          or (
            length(v_normalized_account) >= 6
            and position(v_normalized_account in regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g')) > 0
          )
        )
      for update;
    end if;
  end if;

  if v_card.id is null then
    raise exception 'Hesap numarasi "%" ile eslesecek banka hesabi bulunamadi. Kartlar sayfasinda ilgili hesabin "Hesap numarasi" alanina SMS''teki numarayi (veya bir kismini) yaz.', p_account_number;
  end if;

  if p_direction = 'out' then
    update public.cards
    set current_balance = current_balance - v_amount,
        updated_at = now()
    where id = v_card.id
    returning * into v_card;
  else
    update public.cards
    set current_balance = current_balance + v_amount,
        updated_at = now()
    where id = v_card.id
    returning * into v_card;
  end if;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_card.user_id,
    'transfer',
    case
      when p_direction = 'out' then p_counterparty || ' adina ' || coalesce(p_transaction_type, '') || ' gonderimi'
      else p_counterparty || ' tarafindan ' || coalesce(p_transaction_type, '') || ' geldi'
    end,
    v_amount,
    'cards',
    v_card.id,
    'SMS otomasyonu ile kaydedildi.'
  );

  return v_card;
end;
$$;

revoke execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) from public;
revoke execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) from anon;
grant execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) to authenticated;
grant execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) to service_role;
