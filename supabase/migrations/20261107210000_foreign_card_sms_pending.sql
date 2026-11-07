-- Döviz SMS'i TL tutarı öğrenilene kadar finansal etki üretmez.
create unique index if not exists cards_id_user_foreign_sms_idx on public.cards(id,user_id);
create table public.foreign_card_sms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  native_amount numeric(14,2) not null check (native_amount > 0 and native_amount < 1000000000000),
  currency text not null check (currency in ('USD','EUR','GBP')),
  description text not null check (length(btrim(description)) between 1 and 1000),
  spent_at timestamptz not null,
  category text not null default 'Diğer',
  source_event_id text not null check (length(btrim(source_event_id)) between 1 and 200),
  raw_sms text not null check (length(raw_sms) between 1 and 10000),
  message_hash text not null check(message_hash ~ '^[a-f0-9]{64}$'),
  completed_amount numeric(14,2),
  completed_at timestamptz,
  foreign key(card_id,user_id) references public.cards(id,user_id) on delete cascade,
  unique(user_id,source_event_id),
  unique(user_id,message_hash),
  check ((completed_at is null and completed_amount is null) or
    (completed_at is not null and completed_amount is not null and completed_amount > 0 and completed_amount < 1000000000000))
);
create index foreign_card_sms_user_idx on public.foreign_card_sms(user_id);
alter table public.foreign_card_sms enable row level security;
create policy "own rows" on public.foreign_card_sms for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.foreign_card_sms from anon,authenticated;
grant select on public.foreign_card_sms to authenticated;
create trigger foreign_card_sms_updated_at before update on public.foreign_card_sms for each row execute function public.set_updated_at();

-- Servis veya oturum sahibi yalnız kendi kartına inceleme kaydı bırakabilir.
-- Geçmiş hata SMS'lerini frontend aynasından kurtarmak için authenticated de açıktır.
create function public.queue_foreign_card_sms(
 p_user_id uuid,p_card_id uuid,p_native_amount numeric,p_currency text,p_description text,
 p_spent_at timestamptz,p_category text,p_source_event_id text,p_raw_sms text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_row public.foreign_card_sms%rowtype; v_hash text;
begin
 if p_user_id is null or (coalesce((select auth.role()),'') <> 'service_role' and (select auth.uid()) is distinct from p_user_id) then
  raise exception 'Dövizli SMS sahibi doğrulanamadı.';
 end if;
 if p_native_amount is null or p_native_amount <> round(p_native_amount,2) then raise exception 'Geçersiz döviz tutarı.'; end if;
 if p_raw_sms is null or length(p_raw_sms) not between 1 and 10000 then raise exception 'Geçersiz SMS metni.'; end if;
 v_hash:=encode(pg_catalog.sha256(pg_catalog.convert_to(btrim(regexp_replace(p_raw_sms,'\s+',' ','g')),'UTF8')),'hex');
 if not exists(select 1 from public.cards where id=p_card_id and user_id=p_user_id and card_type='kredi_karti') then raise exception 'Kredi kartı bulunamadı.'; end if;
 insert into public.foreign_card_sms(user_id,card_id,native_amount,currency,description,spent_at,category,source_event_id,raw_sms,message_hash)
 values(p_user_id,p_card_id,p_native_amount,p_currency,btrim(p_description),p_spent_at,coalesce(nullif(btrim(p_category),''),'Diğer'),btrim(p_source_event_id),p_raw_sms,v_hash)
 on conflict do nothing returning * into v_row;
 if not found then
  select * into v_row from public.foreign_card_sms where user_id=p_user_id and
   (source_event_id=btrim(p_source_event_id) or message_hash=v_hash);
  if v_row.id is null or v_row.card_id<>p_card_id or v_row.native_amount<>p_native_amount or v_row.currency<>p_currency
   or v_row.description<>btrim(p_description) or v_row.spent_at<>p_spent_at
   or v_row.message_hash<>v_hash then
   raise exception 'SMS olay kimliği farklı bir işlem için kullanılmış.';
  end if;
 end if;
 return v_row.id;
end $$;
revoke all on function public.queue_foreign_card_sms(uuid,uuid,numeric,text,text,timestamptz,text,text,text) from public,anon;
grant execute on function public.queue_foreign_card_sms(uuid,uuid,numeric,text,text,timestamptz,text,text,text) to authenticated,service_role;

create function public.complete_foreign_card_sms(p_id uuid,p_amount_tl numeric)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid()); v_row public.foreign_card_sms%rowtype; v_expense public.card_expenses%rowtype;
begin
 if v_user is null then raise exception 'Oturum bulunamadı.'; end if;
 if p_amount_tl is null or p_amount_tl<=0 or p_amount_tl>=1000000000000 or p_amount_tl<>round(p_amount_tl,2) then raise exception 'Geçerli bir kesin TL tutarı gir.'; end if;
 select * into v_row from public.foreign_card_sms where id=p_id and user_id=v_user for update;
 if not found then raise exception 'Bekleyen dövizli SMS bulunamadı.'; end if;
 if v_row.completed_at is not null then
  if v_row.completed_amount<>p_amount_tl then raise exception 'Bu SMS farklı bir TL tutarıyla zaten tamamlandı.'; end if;
  return;
 end if;
 v_expense := public.add_card_expense(p_card_id=>v_row.card_id,p_amount=>p_amount_tl,p_description=>v_row.description,
  p_spent_at=>(v_row.spent_at at time zone 'Europe/Istanbul')::date,p_installment_count=>1,p_category=>v_row.category,
  p_status=>'provision',p_user_id=>v_user,p_source=>'sms',p_source_event_id=>v_row.source_event_id);
 if v_expense.card_id<>v_row.card_id or v_expense.amount<>p_amount_tl or v_expense.status='cancelled'
  or v_expense.description<>v_row.description or v_expense.spent_at<>(v_row.spent_at at time zone 'Europe/Istanbul')::date then
  raise exception 'SMS daha önce farklı bir harcamaya bağlanmış; kayıtları incele.';
 end if;
 perform private.reconcile_card_payment_expenses(v_user,v_row.card_id);
 if not exists(select 1 from public.transaction_history where user_id=v_user and type='payment' and matched_card_expense_id=v_expense.id) then
  perform private.apply_card_installment_intent(v_expense.id,v_user);
 end if;
 update public.foreign_card_sms set completed_amount=p_amount_tl,completed_at=now() where id=v_row.id;
end $$;
revoke all on function public.complete_foreign_card_sms(uuid,numeric) from public,anon;
grant execute on function public.complete_foreign_card_sms(uuid,numeric) to authenticated;

-- JSON restore: mevcut zincirden sonra, kartlar hazırken inceleme makbuzları.
alter function public.restore_user_finance_data_tx(jsonb) rename to restore_user_finance_data_tx_without_foreign_sms;
revoke all on function public.restore_user_finance_data_tx_without_foreign_sms(jsonb) from public,anon,authenticated;
create function public.restore_user_finance_data_tx(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid()); v_rows jsonb:=p_payload->'tables'->'foreign_card_sms'; v_result jsonb; v_count integer;
begin
 if v_user is null then raise exception 'Oturum bulunamadı.'; end if;
 if coalesce(p_payload->>'schema','')<>'financeproject-v2' then raise exception 'Tanınmayan yedek şeması.'; end if;
 if jsonb_typeof(p_payload->'tables') is distinct from 'object' then raise exception 'Yedek gövdesi (tables) eksik ya da nesne değil.'; end if;
 if pg_catalog.pg_column_size(p_payload)>32*1024*1024 then raise exception 'Yedek dosyası beklenmedik kadar büyük (32 MB sınırı).'; end if;
 if v_rows is not null then
  if jsonb_typeof(v_rows) is distinct from 'array' then raise exception 'Dövizli SMS kayıtları liste olmalı.'; end if;
  if exists(select 1 from jsonb_array_elements(v_rows) r where jsonb_typeof(r)<>'object') then raise exception 'Geçersiz dövizli SMS kaydı.'; end if;
  if exists(select 1 from jsonb_array_elements(v_rows) r,jsonb_object_keys(r) k where k<>all(array['id','user_id','card_id','created_at','updated_at','native_amount','currency','description','spent_at','category','source_event_id','raw_sms','message_hash','completed_amount','completed_at'])) then raise exception 'Dövizli SMS kaydında tanınmayan kolon var.'; end if;
 end if;
 v_result:=public.restore_user_finance_data_tx_without_foreign_sms(jsonb_set(p_payload,'{tables}',(p_payload->'tables')-'foreign_card_sms'));
 insert into public.foreign_card_sms(id,user_id,card_id,created_at,updated_at,native_amount,currency,description,spent_at,category,source_event_id,raw_sms,message_hash,completed_amount,completed_at)
 select coalesce(r.id,gen_random_uuid()),v_user,r.card_id,coalesce(r.created_at,now()),coalesce(r.updated_at,now()),r.native_amount,r.currency,r.description,r.spent_at,coalesce(r.category,'Diğer'),r.source_event_id,r.raw_sms,
  encode(pg_catalog.sha256(pg_catalog.convert_to(btrim(regexp_replace(r.raw_sms,'\s+',' ','g')),'UTF8')),'hex'),r.completed_amount,r.completed_at
 from jsonb_to_recordset(coalesce(v_rows,'[]'::jsonb)) as r(id uuid,card_id uuid,created_at timestamptz,updated_at timestamptz,native_amount numeric,currency text,description text,spent_at timestamptz,category text,source_event_id text,raw_sms text,completed_amount numeric,completed_at timestamptz);
 get diagnostics v_count=row_count;
 return jsonb_set(v_result,'{tables,foreign_card_sms}',to_jsonb(v_count),true);
end $$;
revoke all on function public.restore_user_finance_data_tx(jsonb) from public,anon;
grant execute on function public.restore_user_finance_data_tx(jsonb) to authenticated;
