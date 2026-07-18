-- Quantity-bearing assets must move their source amount with the cash leg.
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
  if p_direction = 'sell' and round(v_amount * 100)::bigint > round(v_asset.estimated_value_try * 100)::bigint then
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
        else v_asset.estimated_value_try
      end;
      v_next_unit_cost := round((v_existing_cost + v_amount) / v_next_amount, 2);
    else
      v_next_unit_cost := v_asset.unit_cost;
    end if;
  else
    v_account := private.credit_bank_account(p_account_card_id, v_amount);
    v_next_value := greatest(0, round(v_asset.estimated_value_try - v_amount, 2));
    v_next_amount := case when v_quantity is null then v_asset.amount else greatest(0, round(v_asset.amount - v_quantity, 2)) end;
    v_next_unit_cost := case when v_asset.category = 'Hisse' and v_next_amount = 0 then null else v_asset.unit_cost end;
  end if;

  update public.assets
  set amount = v_next_amount, estimated_value_try = v_next_value,
      unit_cost = v_next_unit_cost, updated_at = now()
  where id = v_asset.id returning * into v_updated;

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
