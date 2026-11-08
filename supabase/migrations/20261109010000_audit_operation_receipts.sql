-- M02/M12/M17/M23: opak kullanıcı+UUID+hash, ödeme makbuzuyla aynı koruma.
-- Reset/restore hash'i silmez; ham tutar/hesap/yedek payload'ı makbuzda tutulmaz.
create function public.submit_finance_operation(p_request_id uuid, p_method text, p_args jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); previous_hash bytea; request_hash bytea;
begin
 if u is null then raise exception 'Oturum bulunamadı.'; end if;
 if p_request_id is null or p_args is null or jsonb_typeof(p_args)<>'object' then raise exception 'İşlem kimliği ve alanları gerekli.'; end if;
 if p_method not in ('record_manual_account_movement','transfer_between_accounts','trade_asset_with_account','update_asset_value','contribute_to_goal_bucket','restore_user_finance_data_tx') then raise exception 'Bu işlem türü desteklenmiyor.'; end if;
 request_hash:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('operation',p_method,'args',p_args)::text,'UTF8'));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,1647595321));
 select r.request_hash into previous_hash from private.finance_payment_requests r where r.user_id=u and r.request_id=p_request_id;
 if found then
  if previous_hash<>request_hash then raise exception 'Bu işlem kimliği farklı alanlarla kullanılamaz.'; end if;
  return;
 end if;
 case p_method
 when 'record_manual_account_movement' then
  perform public.record_manual_account_movement((p_args->>'p_card_id')::uuid,(p_args->>'p_amount')::numeric,p_args->>'p_direction',p_args->>'p_note');
 when 'transfer_between_accounts' then
  perform public.transfer_between_accounts((p_args->>'p_source_card_id')::uuid,(p_args->>'p_target_card_id')::uuid,(p_args->>'p_amount')::numeric,p_args->>'p_note');
 when 'trade_asset_with_account' then
  perform public.trade_asset_with_account((p_args->>'p_asset_id')::uuid,(p_args->>'p_account_card_id')::uuid,p_args->>'p_direction',(p_args->>'p_amount')::numeric,(p_args->>'p_quantity')::numeric,p_args->>'p_note');
 when 'update_asset_value' then
  perform public.update_asset_value((p_args->>'p_asset_id')::uuid,(p_args->>'p_value')::numeric,(p_args->>'p_contribution')::numeric,(p_args->>'p_occurred_at')::timestamptz,p_args->>'p_note');
 when 'contribute_to_goal_bucket' then
  perform public.contribute_to_goal_bucket((p_args->>'p_bucket_id')::uuid,(p_args->>'p_amount')::numeric);
 when 'restore_user_finance_data_tx' then
  perform public.restore_user_finance_data_tx(p_args->'p_payload');
 end case;
 insert into private.finance_payment_requests(user_id,request_id,request_hash) values(u,p_request_id,request_hash);
end $$;
revoke all on function public.submit_finance_operation(uuid,text,jsonb) from public,anon;
grant execute on function public.submit_finance_operation(uuid,text,jsonb) to authenticated;

-- M14/M16: miktar para değildir; lot hassasiyeti özet varlıkta korunur.
alter table public.assets alter column amount type numeric(24,8);

create function private.lock_gold_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(new.user_id,old.user_id)::text,1647595321));
 return coalesce(new,old);
end $$;
create trigger lock_gold_inventory before insert or update or delete on public.gold_lots
for each row execute function private.lock_gold_inventory();

create function private.check_gold_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
declare u uuid:=coalesce(new.user_id,old.user_id);
begin
 if exists (
  select 1 from (
   select sum(case when direction='sell' then -quantity else quantity end) over (
    partition by gold_type order by coalesce(purchase_date,'0001-01-01'::date),
    case when direction='sell' then 1 else 0 end,created_at,id rows unbounded preceding
   ) as held from public.gold_lots where user_id=u
  ) positions where held<0
 ) then raise exception 'Altın işlem geçmişinde stok eksiye düşemez; miktar, tarih ve türü kontrol edin.'; end if;
 return null;
end $$;
-- Restore sırasında ara sıralama değil, transaction sonunda tam defter denetlenir.
create constraint trigger check_gold_inventory after insert or update or delete on public.gold_lots
deferrable initially deferred for each row execute function private.check_gold_inventory();
revoke all on function private.lock_gold_inventory() from public,anon,authenticated;
revoke all on function private.check_gold_inventory() from public,anon,authenticated;
