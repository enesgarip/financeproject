-- Yapı Kredi B016: maskeyi rakama indirgemeden banka + iki uç ile eşleştir.
-- Üç yıldızın gizlediği hane sayısı varsayılmaz. Sadece önek/son ek yetmez:
-- bankanın adı ve tek aday şarttır; cash hesabı ve diğer banka sayılmaz.
create or replace function private.matches_yapikredi_sms_account(
  p_account_number text, p_masked_number text, p_bank_name text
)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    length(p_masked_number) <= 64
    and p_masked_number ~ '^[0-9]{2,}\*+[0-9]{3,}$'
    and regexp_replace(lower(translate(p_bank_name,'İIı','iii')), '[^a-z0-9]', '', 'g')
      in ('yapikredi','yapikredibankasi','yapivekredibankasi')
    and (
      regexp_replace(regexp_replace(p_account_number,'[^0-9*]','','g'),'\*+','*','g')
        = regexp_replace(p_masked_number,'\*+','*','g')
      or regexp_replace(p_account_number,'[^0-9]','','g') ~
        ('^' || split_part(p_masked_number,'*',1) || '[0-9]+' || substring(p_masked_number from '\*+([0-9]+)$') || '$')
    ), false);
$$;
revoke all on function private.matches_yapikredi_sms_account(text,text,text) from public, anon, authenticated, service_role;

-- RPC imzası, service-role sınırı ve bakiye/ledger/geçmiş/borç eşleme gövdesi
-- korunur; yalnız maskeli hesap çözümleme kolu eklenir.

create or replace function public.record_sms_account_movement(
  p_account_number text,
  p_amount numeric,
  p_direction text,
  p_counterparty text,
  p_occurred_at timestamptz default now(),
  p_transaction_type text default null,
  p_user_id uuid default null,
  p_source_event_id text default null
)
returns jsonb
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
  v_candidates uuid[];
  v_source_event_id text := nullif(btrim(coalesce(p_source_event_id, '')), '');
  v_existing_card_id uuid;
  v_match jsonb;
  v_debt public.debts%rowtype;
  v_debt_value numeric(14, 2);
  v_pay numeric(14, 2);
  v_matched jsonb := null;
begin
  -- p_user_id yalnız güvenilir edge/service-role çağrısının owner daraltmasıdır.
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

  if position('*' in coalesce(p_account_number, '')) > 0 then
    if length(p_account_number) > 64 or p_account_number !~ '^[0-9]{2,}\*+[0-9]{3,}$' then
      raise exception 'Maskeli hesap numarasi gecersiz.';
    end if;
    select array_agg(id order by id) into v_candidates from public.cards
    where (v_user_id is null or user_id = v_user_id)
      and card_type = 'banka_karti' and coalesce(account_kind, 'bank') = 'bank'
      and private.matches_yapikredi_sms_account(account_number, p_account_number, bank_name);
    if cardinality(v_candidates) > 1 then
      raise exception 'Maskeli hesap numarasi birden fazla Yapi Kredi hesabiyla eslesti. Hesap numaralarini netlestir.';
    end if;
    if cardinality(v_candidates) = 1 then
      select * into v_card from public.cards
      where id = v_candidates[1]
        and (v_user_id is null or user_id = v_user_id)
        and card_type = 'banka_karti' and coalesce(account_kind, 'bank') = 'bank'
        and private.matches_yapikredi_sms_account(account_number, p_account_number, bank_name)
      for update;
    end if;
  else
    v_normalized_account := regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g');
    if v_normalized_account = '' then
      raise exception 'Hesap numarasi bos olamaz.';
    end if;

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

  end if; -- maskeli / normal hesap yolu

  if v_card.id is null then
    raise exception 'Hesap numarasi "%" ile eslesecek banka hesabi bulunamadi. Kartlar sayfasinda ilgili hesabin "Hesap numarasi" alanini doldur.', p_account_number;
  end if;

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
      return jsonb_build_object(
        'id', v_card.id, 'user_id', v_card.user_id, 'card_name', v_card.card_name,
        'current_balance', v_card.current_balance, 'matched_debt', null, 'debt_note', null, 'replayed', true
      );
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

  -- Kişisel alacak/borç eşlemesi: tek aday + tutar sığıyorsa kaydı kapat/kısmi
  -- düş; bakiye zaten oynadı, hesaba dokunma.
  -- Maskeli kişi adı kimlik kanıtı değildir; yalnız banka hareketi kaydedilir.
  v_match := case when position('*' in coalesce(p_counterparty, '')) > 0
    then jsonb_build_object('debt_id', null, 'note', 'kisisel kayit eslenmedi: gonderici adi maskeli')
    else private.match_open_personal_debt(v_card.user_id, p_direction, p_counterparty, v_amount) end;
  if (v_match->>'debt_id') is not null then
    select * into v_debt from public.debts where id = (v_match->>'debt_id')::uuid;
    v_debt_value := round(v_debt.estimated_value_try, 2);
    v_pay := least(v_amount, v_debt_value);
    v_debt := private.settle_personal_debt_internal(
      v_card.user_id, v_debt.id, v_card.id, v_pay, true, coalesce(p_occurred_at, now()), v_source_event_id
    );
    v_matched := jsonb_build_object(
      'id', v_debt.id,
      'person_name', v_debt.person_name,
      'direction', v_debt.direction,
      'paid', v_pay,
      'closed', v_debt.status = 'kapandı',
      'remaining', case when v_debt.status = 'kapandı' then 0 else round(v_debt.estimated_value_try, 2) end
    );
  end if;

  return jsonb_build_object(
    'id', v_card.id, 'user_id', v_card.user_id, 'card_name', v_card.card_name,
    'current_balance', v_card.current_balance, 'matched_debt', v_matched, 'debt_note', v_match->>'note', 'replayed', false
  );
end;
$$;

revoke execute on function public.record_sms_account_movement(
  text, numeric, text, text, timestamptz, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.record_sms_account_movement(
  text, numeric, text, text, timestamptz, text, uuid, text
) to service_role;
