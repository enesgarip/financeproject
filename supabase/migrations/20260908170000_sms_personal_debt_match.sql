-- Gelen/giden hesap SMS'i ↔ açık kişisel alacak/borç kaydı otomatik eşleme.
--
-- Vaka (2026-09-08): arkadaş FAST ile 8.000 TL gönderdi. SMS otomasyonu
-- hesaba parayı doğru ekledi; kullanıcı ayrıca borç kaydındaki "Tahsil et"e
-- bastı ve settle_personal_debt hesabı İKİNCİ kez kredilendirdi. Parser
-- gönderici adını zaten çıkarıyordu (p_counterparty) ama RPC onu yalnız geçmiş
-- başlığında kullanıyordu.
--
-- Çözüm (kart SMS ↔ otomatik ödeme eşleme deseni, 20260809200000):
--  * private.fold_match_text — normalize_match_text + Türkçe aksan katlama
--    (ş/ğ/ç/ö/ü/ı): "Furkan Kurtuldu" ↔ "FURKAN KURTULDU" ↔ "furkan kurtuldu".
--  * private.match_open_personal_debt — kayıttaki adın HER kelimesi gönderici
--    adında tam kelime olarak geçen, aynı yönlü (giriş→borç_verdim,
--    çıkış→borç_aldım), TRY, açık kayıtlar. TAM OLARAK BİR aday varsa ve tutar
--    kayıt değerini (max 5 TL / %1 toleransla) aşmıyorsa eşler; 0 ya da >1
--    aday, ya da tutar büyükse hiçbir şey yapmaz (tahmin yok) ve sebebi notta
--    döner (sms_log özetine yazılır).
--  * private.settle_personal_debt_internal — settle_personal_debt'in gövdesi,
--    kullanıcı kimliği parametreyle; p_skip_account_move=true ise hesaba
--    DOKUNMAZ (SMS bakiyeyi zaten oynattı), yalnız kaydı kapatır/kısmi düşer.
--  * public.settle_personal_debt — aynı gövdeyi sarar; yeni opsiyonel
--    p_skip_account_move ile elle "Tahsil et" yolu da "para zaten geldi"
--    diyebilir (kart ödemesindeki p_skip_source_debit'in ikizi).
--  * record_sms_account_movement — bakiye + geçmiş yazımından sonra eşler;
--    dönüş tipi jsonb'ye geçti (kart alanları + matched_debt + debt_note) ki
--    edge fonksiyonu özeti yazabilsin. Retry erken dönüşü eşlemeye girmez.
--
-- Bilinçli sınırlar: yalnız value_type='TRY' kayıtlar (döviz/altın kaydının
-- TL değeri canlı kur tahminidir, tutar toleransı anlamsız). due_date şartı
-- yok (vadesiz alacaklar da eşlenir).

-- ── 1) Türkçe aksan katlamalı eşleme metni ─────────────────────────────────
create or replace function private.fold_match_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.translate(private.normalize_match_text(p_value), 'şğçöüıŞĞÇÖÜ', 'sgcouisgcou');
$$;

revoke all on function private.fold_match_text(text) from public, anon, authenticated;

-- ── 2) Aday kayıt seçimi ──────────────────────────────────────────────────────
create or replace function private.match_open_personal_debt(
  p_user_id uuid,
  p_direction text,
  p_counterparty text,
  p_amount numeric
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_debt_direction text := case when p_direction = 'in' then 'borç_verdim' else 'borç_aldım' end;
  v_counterparty text := private.fold_match_text(p_counterparty);
  v_tolerance numeric;
  v_count integer;
  v_id uuid;
  v_value numeric;
begin
  if v_counterparty = '' or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('debt_id', null, 'note', null);
  end if;

  -- Tutardan bağımsız isim adayları: kayıttaki adın her kelimesi (≥2 harf)
  -- gönderici adında TAM KELİME olarak geçmeli ("ali" ↔ "halil" eşleşmez).
  select count(*), (array_agg(d.id order by d.created_at))[1], (array_agg(d.estimated_value_try order by d.created_at))[1]
  into v_count, v_id, v_value
  from public.debts d
  where d.user_id = p_user_id
    and d.status = 'açık'
    and d.direction = v_debt_direction
    and d.value_type = 'TRY'
    and d.estimated_value_try > 0
    and private.fold_match_text(d.person_name) <> ''
    and not exists (
      select 1
      from unnest(string_to_array(private.fold_match_text(d.person_name), ' ')) as t(token)
      where length(t.token) >= 2
        and position(' ' || t.token || ' ' in ' ' || v_counterparty || ' ') = 0
    );

  if v_count = 0 then
    return jsonb_build_object('debt_id', null, 'note', null);
  end if;
  if v_count > 1 then
    return jsonb_build_object('debt_id', null, 'note', 'kisisel kayit eslenmedi: ' || v_count || ' acik kayit ayni ada uyuyor');
  end if;

  v_tolerance := greatest(5::numeric, round(p_amount * 0.01, 2));
  if p_amount > round(v_value, 2) + v_tolerance then
    return jsonb_build_object('debt_id', null, 'note', 'kisisel kayit eslenmedi: tutar kayit degerinden (' || round(v_value, 2)::text || ' TL) buyuk');
  end if;

  return jsonb_build_object('debt_id', v_id, 'note', null);
end;
$$;

revoke all on function private.match_open_personal_debt(uuid, text, text, numeric) from public, anon, authenticated;

-- ── 3) Ortak gövde: kapama / kısmi düşme ────────────────────────────────────
create or replace function private.settle_personal_debt_internal(
  p_user_id uuid,
  p_debt_id uuid,
  p_account_card_id uuid,
  p_amount numeric,
  p_skip_account_move boolean,
  p_occurred_at timestamptz,
  p_source_event_id text
)
returns public.debts
language plpgsql
set search_path = ''
as $$
declare
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
  if p_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_debt
  from public.debts
  where id = p_debt_id
    and user_id = p_user_id
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

  if p_skip_account_move then
    -- Bakiye banka/SMS hareketiyle zaten oynadı; hesabı yalnız doğrula.
    select *
    into v_account
    from public.cards
    where id = p_account_card_id
      and user_id = p_user_id
      and card_type = 'banka_karti'
    for update;
    if not found then
      raise exception 'Banka hesabi bulunamadi.';
    end if;
  elsif v_debt.direction = 'borç_aldım' then
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

  -- Not metni realizedCashFlow'un yön anahtarlarını korur ("hesabından ödendi"
  -- = nakit çıkışı); skip eki bilgi amaçlıdır.
  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note, occurred_at, source_event_id)
  values (
    p_user_id,
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
      when p_skip_account_move then ' Bakiye SMS/banka hareketiyle zaten degismisti; tekrar oynatilmadi.'
      else ''
    end || case
      when v_is_partial then ' Kalan değer: ' || v_next_value::text || ' TL.'
      else ''
    end,
    coalesce(p_occurred_at, now()),
    nullif(btrim(coalesce(p_source_event_id, '')), '')
  );

  return v_result;
end;
$$;

revoke all on function private.settle_personal_debt_internal(uuid, uuid, uuid, numeric, boolean, timestamptz, text) from public, anon, authenticated;

-- ── 4) Public sarmalayıcı: yeni opsiyonel p_skip_account_move ───────────────
-- Eski 3-arg overload kaldırılır (PostgREST named-arg belirsizliği).
drop function if exists public.settle_personal_debt(uuid, uuid, numeric);

create function public.settle_personal_debt(
  p_debt_id uuid,
  p_account_card_id uuid,
  p_amount numeric default null,
  p_skip_account_move boolean default false
)
returns public.debts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;
  return private.settle_personal_debt_internal(
    v_user_id, p_debt_id, p_account_card_id, p_amount, coalesce(p_skip_account_move, false), now(), null
  );
end;
$$;

revoke execute on function public.settle_personal_debt(uuid, uuid, numeric, boolean) from public;
revoke execute on function public.settle_personal_debt(uuid, uuid, numeric, boolean) from anon;
grant execute on function public.settle_personal_debt(uuid, uuid, numeric, boolean) to authenticated;

-- ── 5) SMS hesap hareketi: eşleme + jsonb dönüş ──────────────────────────────
-- Gövde 20260802180000 ile aynı; eklenenler: eşleme bloğu ve jsonb dönüş.
drop function if exists public.record_sms_account_movement(
  text, numeric, text, text, timestamptz, text, uuid, text
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
  v_match := private.match_open_personal_debt(v_card.user_id, p_direction, p_counterparty, v_amount);
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
