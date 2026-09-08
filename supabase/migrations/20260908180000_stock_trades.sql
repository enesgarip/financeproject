-- Hisse işlem defteri (`stock_trades`): portföy performansının veri tabanı.
--
-- Sorun: `trade_asset_with_account` `assets` satırını YERİNDE değiştiriyor
-- (adet, değer, yürüyen ortalama `unit_cost`); pozisyon sıfırlanınca maliyet
-- siliniyor. Tarih, komisyon, gerçekleşmiş kâr hiçbir yerde yok — "1 Ocak'tan
-- bu yana ne kazandım" bugün hesaplanamıyor. Altın tarafı bunu `gold_lots`
-- ile çözmüştü; şablon o.
--
-- Model (altından farkı): `assets` Hisse satırı KANONİK kalır (hedef kaynağı,
-- net değer, canlı fiyat senkronu onu okur). `stock_trades` tarihçedir:
--  * kind = buy | sell | opening. `opening` = defter başlangıcındaki pozisyon
--    (migration mevcut Hisse satırlarından türetir); kullanıcı geçmiş
--    işlemleri girip açılış satırını silebilir.
--  * `trade_asset_with_account` Hisse + miktarlı işlemde aynı transaction'da
--    satır yazar (source='trade_rpc'). Elle girilen geçmiş işlem (source=
--    'manual') YALNIZ defteri besler: nakit ve varlık satırı değişmez.
--  * unit_price nullable: maliyeti bilinmeyen açılış satırı adette sayılır,
--    maliyet tabanına girmez (gold_lots deseni).
--  * Defter projeksiyonu ile varlık adedi uyuşmazsa sayfa uyarır; assets'i
--    defterden yeniden yazmaz (trade RPC ile çelişmemek için).
--
-- Saf ikiz: utils/stockLedger.ts (ağırlıklı ortalama maliyet, gerçekleşmiş /
-- gerçekleşmemiş K/Z, nakit-akış düzeltilmiş dönem getirisi).

create table public.stock_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Varlık silinse de tarihçe kalsın; sembol asıl anahtar.
  asset_id uuid references public.assets(id) on delete set null,
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,10}$'),
  kind text not null check (kind in ('buy', 'sell', 'opening')),
  trade_date date not null,
  quantity numeric(15, 4) not null check (quantity > 0),
  unit_price numeric(15, 4) check (unit_price is null or unit_price >= 0),
  fee numeric(14, 2) not null default 0 check (fee >= 0),
  source text not null default 'manual' check (source in ('manual', 'trade_rpc', 'opening')),
  note text
);

create index stock_trades_user_symbol_date_idx on public.stock_trades (user_id, symbol, trade_date);
create index stock_trades_user_date_idx on public.stock_trades (user_id, trade_date desc);

alter table public.stock_trades enable row level security;

create policy "own rows" on public.stock_trades
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger set_updated_at
  before update on public.stock_trades
  for each row
  execute function public.set_updated_at();

grant select, insert, update, delete on table public.stock_trades to authenticated;

-- ── Açılış pozisyonları: mevcut Hisse satırları ─────────────────────────────
insert into public.stock_trades (user_id, asset_id, symbol, kind, trade_date, quantity, unit_price, fee, source, note)
select a.user_id, a.id, a.symbol, 'opening', private.today_ist(), a.amount, a.unit_cost, 0, 'opening',
       'Defter başlangıcı: Varlıklar satırındaki pozisyon. Geçmiş işlemleri girersen bu satırı sil.'
from public.assets a
where a.category = 'Hisse'
  and a.symbol is not null
  and a.symbol ~ '^[A-Z0-9]{1,10}$'
  and a.amount > 0;

-- ── trade_asset_with_account: Hisse işleminde defter satırı ─────────────────
-- Gövde 20260810180000 ile aynı; tek ek: Hisse + miktarlı işlemde stock_trades
-- insert'i (birim fiyat = nakit / adet, komisyon modalda yok → 0).
create or replace function public.trade_asset_with_account(
  p_asset_id uuid, p_account_card_id uuid, p_direction text, p_amount numeric,
  p_quantity numeric default null, p_note text default null
)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_asset public.assets%rowtype;
  v_updated public.assets%rowtype;
  v_account public.cards%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_quantity numeric(14, 2) := case when p_quantity is null then null else round(p_quantity, 2) end;
  v_next_amount numeric(14, 2);
  v_next_value numeric(14, 2);
  v_existing_cost numeric(14, 2);
  v_next_unit_cost numeric(14, 2);
  v_note text;
begin
  if v_user_id is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_direction not in ('buy', 'sell') then raise exception 'Geçersiz varlık işlemi.'; end if;
  if v_amount <= 0 then raise exception 'İşlem tutarı 0 dan büyük olmalı.'; end if;
  if v_quantity is not null and v_quantity <= 0 then raise exception 'Miktar 0 dan büyük olmalı.'; end if;

  select * into v_asset from public.assets
  where id = p_asset_id and user_id = v_user_id for update;

  if not found then raise exception 'Varlık bulunamadı.'; end if;
  if v_asset.source = 'gold_ledger' or v_asset.category = 'Altın' then
    raise exception 'Altın varlıkları Altın sekmesindeki defterden yönetilir.';
  end if;
  if (v_asset.category in ('Hisse', 'Fon') or
      (v_asset.category = 'Nakit' and coalesce(v_asset.currency, 'TRY') <> 'TRY'))
     and v_quantity is null then
    raise exception 'Hisse, fon ve döviz işlemlerinde miktar girilmeli.';
  end if;
  if p_direction = 'sell' and v_quantity is null
     and round(v_amount * 100)::bigint > round(v_asset.estimated_value_try * 100)::bigint then
    raise exception 'Satış tutarı varlığın kayıtlı değerinden büyük olamaz.';
  end if;
  if p_direction = 'sell' and v_quantity is not null and v_quantity > v_asset.amount then
    raise exception 'Satış miktarı mevcut miktardan büyük olamaz.';
  end if;

  if p_direction = 'buy' then
    v_account := private.debit_bank_account(p_account_card_id, v_amount);
    v_next_value := round(v_asset.estimated_value_try + v_amount, 2);
    v_next_amount := case when v_quantity is null then v_asset.amount else round(v_asset.amount + v_quantity, 2) end;
    if v_asset.category = 'Hisse' and v_quantity is not null and v_next_amount > 0 then
      v_existing_cost := case
        when v_asset.unit_cost is not null and v_asset.amount > 0 then round(v_asset.unit_cost * v_asset.amount, 2)
        else v_asset.estimated_value_try end;
      v_next_unit_cost := round((v_existing_cost + v_amount) / v_next_amount, 2);
    else
      v_next_unit_cost := v_asset.unit_cost;
    end if;
  else
    v_account := private.credit_bank_account(p_account_card_id, v_amount);
    if v_quantity is null then
      v_next_amount := v_asset.amount;
      v_next_value := greatest(0, round(v_asset.estimated_value_try - v_amount, 2));
    else
      v_next_amount := greatest(0, round(v_asset.amount - v_quantity, 2));
      if v_next_amount = 0 then
        v_next_value := 0;
      elsif v_asset.amount > 0 then
        v_next_value := greatest(0, round(v_asset.estimated_value_try * v_next_amount / v_asset.amount, 2));
      else
        v_next_value := greatest(0, round(v_asset.estimated_value_try - v_amount, 2));
      end if;
    end if;
    v_next_unit_cost := case when v_asset.category = 'Hisse' and v_next_amount = 0 then null else v_asset.unit_cost end;
  end if;

  update public.assets
  set amount = v_next_amount, estimated_value_try = v_next_value,
      unit_cost = v_next_unit_cost, updated_at = now()
  where id = v_asset.id returning * into v_updated;

  -- Hisse işlem defteri: aynı transaction, nakit bacağıyla birlikte.
  if v_asset.category = 'Hisse' and v_quantity is not null
     and v_asset.symbol is not null and v_asset.symbol ~ '^[A-Z0-9]{1,10}$' then
    insert into public.stock_trades (user_id, asset_id, symbol, kind, trade_date, quantity, unit_price, fee, source, note)
    values (v_user_id, v_asset.id, v_asset.symbol, p_direction, private.today_ist(), v_quantity,
            round(v_amount / v_quantity, 4), 0, 'trade_rpc', nullif(btrim(coalesce(p_note, '')), ''));
  end if;

  v_note := case when p_direction = 'buy'
      then v_account.card_name || ' hesabından ödendi.'
      else v_account.card_name || ' hesabına tahsil edildi.' end ||
    ' Varlık değeri ' || v_asset.estimated_value_try::text || ' TL -> ' || v_next_value::text || ' TL.' ||
    case when v_quantity is not null then ' Miktar: ' || v_quantity::text || '.' else '' end ||
    case when nullif(btrim(p_note), '') is not null then ' Not: ' || btrim(p_note) else '' end;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (v_user_id, 'asset', v_asset.name || case when p_direction = 'buy' then ' alındı' else ' satıldı' end,
          v_amount, 'assets', v_asset.id, v_note);
  return v_updated;
end;
$$;

revoke execute on function public.trade_asset_with_account(uuid, uuid, text, numeric, numeric, text) from public;
revoke execute on function public.trade_asset_with_account(uuid, uuid, text, numeric, numeric, text) from anon;
grant execute on function public.trade_asset_with_account(uuid, uuid, text, numeric, numeric, text) to authenticated;
