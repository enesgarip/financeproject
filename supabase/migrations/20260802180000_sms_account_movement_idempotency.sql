-- SMS hesap hareketlerini provider/device olay kimliğiyle tekilleştirir.
-- Aynı webhook retry'ı bakiye, account_ledger ve history'yi ikinci kez
-- değiştirmemeli; farklı olay kimlikli eş işlemler ise ayrı kalmalıdır.

alter table public.transaction_history
  add column if not exists source_event_id text;

alter table public.transaction_history
  drop constraint if exists transaction_history_source_event_id_not_blank;

alter table public.transaction_history
  add constraint transaction_history_source_event_id_not_blank check (
    source_event_id is null or btrim(source_event_id) <> ''
  );

create unique index if not exists transaction_history_source_event_unique_idx
  on public.transaction_history (user_id, source_table, source_event_id)
  where source_event_id is not null;

-- Yeni opsiyonel parametre eski imzayla birlikte bırakılırsa PostgREST named-arg
-- çözümlemesi belirsizleşir; önce eski overload kaldırılır.
drop function if exists public.record_sms_account_movement(
  text, numeric, text, text, timestamptz, text, uuid
);

create function public.record_sms_account_movement(
  p_account_number text,
  p_amount numeric,
  p_direction text,
  p_counterparty text,
  p_occurred_at timestamptz default now(),
  p_transaction_type text default null,
  p_user_id uuid default null,
  p_source_event_id text default null
)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_uid uuid := (select auth.uid());
  v_role text := (select auth.role());
  v_user_id uuid;
  v_card public.cards%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_normalized_account text;
  v_match_count integer;
  v_source_event_id text := nullif(btrim(coalesce(p_source_event_id, '')), '');
  v_existing_card_id uuid;
begin
  -- p_user_id yalnız güvenilir edge/service-role çağrısının owner daraltmasıdır.
  -- Normal kullanıcı başka bir kullanıcı kimliği vererek SECURITY DEFINER
  -- sınırını aşamaz.
  if v_role = 'service_role' then
    v_user_id := p_user_id;
  else
    v_user_id := v_auth_uid;
    if v_user_id is null then
      raise exception 'Oturum bulunamadi.';
    end if;
  end if;

  if p_direction not in ('in', 'out') then
    raise exception 'Gecersiz hareket yonu.';
  end if;

  if v_amount <= 0 then
    raise exception 'Tutar 0 dan buyuk olmali.';
  end if;

  if v_source_event_id is not null and length(v_source_event_id) > 200 then
    raise exception 'Kaynak olay kimligi cok uzun.';
  end if;

  v_normalized_account := regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g');
  if v_normalized_account = '' then
    raise exception 'Hesap numarasi bos olamaz.';
  end if;

  -- Birebir eşleşme. Service role owner vermediyse aynı hesap numarasının
  -- birden fazla kullanıcıda bulunması güvenli biçimde reddedilir.
  select count(*)
  into v_match_count
  from public.cards
  where (v_user_id is null or user_id = v_user_id)
    and card_type = 'banka_karti'
    and regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g') = v_normalized_account;

  if v_match_count > 1 then
    raise exception 'Hesap numarasi "%" birden fazla banka hesabiyla eslesti.', p_account_number;
  end if;

  if v_match_count = 1 then
    select *
    into v_card
    from public.cards
    where (v_user_id is null or user_id = v_user_id)
      and card_type = 'banka_karti'
      and regexp_replace(coalesce(account_number, ''), '[^0-9]', '', 'g') = v_normalized_account
    for update;
  else
    -- Toleranslı eşleşme: karşılıklı içerme, kısa taraf en az 6 rakam.
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
    raise exception 'Hesap numarasi "%" ile eslesecek banka hesabi bulunamadi. Kartlar sayfasinda ilgili hesabin "Hesap numarasi" alanini doldur.', p_account_number;
  end if;

  -- Kart satırı kilitli: aynı hesaba ait eşzamanlı retry, ilk transaction
  -- tamamlandıktan sonra bu kaydı görür. Unique index yarışta son savunmadır.
  if v_source_event_id is not null then
    select source_id
    into v_existing_card_id
    from public.transaction_history
    where user_id = v_card.user_id
      and source_table = 'cards'
      and source_event_id = v_source_event_id;

    if found then
      if v_existing_card_id is distinct from v_card.id then
        raise exception 'Kaynak olay kimligi baska bir hesaba ait.';
      end if;
      return v_card;
    end if;
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

  insert into public.transaction_history (
    user_id, type, title, amount, source_table, source_id, note, occurred_at,
    source_event_id
  )
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
    coalesce(p_occurred_at, now()),
    v_source_event_id
  );

  return v_card;
end;
$$;

revoke execute on function public.record_sms_account_movement(
  text, numeric, text, text, timestamptz, text, uuid, text
) from public;
revoke execute on function public.record_sms_account_movement(
  text, numeric, text, text, timestamptz, text, uuid, text
) from anon;
revoke execute on function public.record_sms_account_movement(
  text, numeric, text, text, timestamptz, text, uuid, text
) from authenticated;
grant execute on function public.record_sms_account_movement(
  text, numeric, text, text, timestamptz, text, uuid, text
) to service_role;
