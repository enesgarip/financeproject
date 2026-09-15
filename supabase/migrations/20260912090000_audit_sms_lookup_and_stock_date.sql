-- AUD-016: dar, yalnız webhook rolüne açık kart çözümleme; tablo grant'i açılmaz.
create or replace function public.resolve_sms_card_alias(p_last_four text, p_owner_id uuid default null)
returns table(card_id uuid, label text, cards jsonb)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.card_id, a.label,
    jsonb_build_object('id', c.id, 'card_name', c.card_name, 'bank_name', c.bank_name, 'user_id', c.user_id)
  from public.card_aliases a join public.cards c on c.id = a.card_id and c.user_id = a.user_id
  where a.last_four_digits = p_last_four
    and c.card_type = 'kredi_karti'
    and (p_owner_id is null or c.user_id = p_owner_id);
$$;
revoke all on function public.resolve_sms_card_alias(text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_sms_card_alias(text, uuid) to service_role;

-- AUD-004: geçmiş defterine gelecek işlem yazma. Eski kayıtlar yeniden yazılmaz.
create or replace function public.validate_stock_trade_date()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.trade_date > (now() at time zone 'Europe/Istanbul')::date then
    raise exception 'Geçmiş işlem tarihi gelecekte olamaz.' using errcode = '22007';
  end if;
  return new;
end;
$$;
create trigger validate_stock_trade_date before insert or update of trade_date on public.stock_trades
for each row execute function public.validate_stock_trade_date();
