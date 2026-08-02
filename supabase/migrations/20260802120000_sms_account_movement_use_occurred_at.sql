-- F-04 (denetim 2026-08-02): record_sms_account_movement, p_occurred_at parametresini
-- alıp KULLANMIYORDU → transaction_history satırı occurred_at kolonunu yazmadığı için
-- SMS ile gelen hesap hareketi işlem-anı yerine işleme-anı (now()) zamanıyla
-- kaydediliyordu. Aktivite akışı (activityFeed.ts) ve financePanelsRepo occurred_at'e
-- göre sıralayıp/filtrelediği için gecikmeli/retry SMS'te hareket yanlış günde
-- görünüyor ve tarih penceresi sorgularını kaçırabiliyordu.
--
-- Düzeltme: INSERT'e occurred_at eklenir ve p_occurred_at'ten türetilir. Sadece
-- transaction_history'nin işlem zamanı düzelir; bakiye/ledger matematiği DEĞİŞMEZ
-- (account_ledger olayı append-only sistem kaydı olarak now() ile kalır). İmza,
-- security definer, search_path ve grant'ler birebir korunur (CREATE OR REPLACE).

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

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note, occurred_at)
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
    'SMS otomasyonu ile kaydedildi.',
    coalesce(p_occurred_at, now())
  );

  return v_card;
end;
$$;

revoke execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) from public;
revoke execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) from anon;
grant execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) to authenticated;
grant execute on function public.record_sms_account_movement(text, numeric, text, text, timestamptz, text, uuid) to service_role;
