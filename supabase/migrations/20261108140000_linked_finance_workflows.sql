-- Recorded income is classified without crediting the account again.
-- Service completion, reporting expense and next reminder commit together.
create unique index if not exists workflow_history_owner_idx on public.transaction_history(id,user_id);
create unique index if not exists workflow_debt_owner_idx on public.debts(id,user_id);
create unique index if not exists workflow_car_expense_owner_idx on public.car_expenses(id,user_id);
create unique index if not exists workflow_card_expense_owner_idx on public.card_expenses(id,user_id);
create unique index if not exists workflow_car_owner_idx on public.cars(id,user_id);

create table public.account_income_labels (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 movement_id uuid not null unique, kind text not null check(kind in ('salary','receivable','own_transfer','other')),
 debt_id uuid, debt_amount numeric(14,2),
 foreign key(movement_id,user_id) references public.transaction_history(id,user_id) on delete cascade,
 foreign key(debt_id,user_id) references public.debts(id,user_id) on delete set null (debt_id),
 check((kind='receivable' and debt_amount is not null and debt_amount>0) or (kind<>'receivable' and debt_amount is null and debt_id is null))
);
create index account_income_labels_user_idx on public.account_income_labels(user_id);
alter table public.account_income_labels enable row level security;
create policy "own labels" on public.account_income_labels for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.account_income_labels from public,anon,authenticated;
grant select on public.account_income_labels to authenticated;

create function public.classify_account_income(p_movement_id uuid,p_kind text,p_debt_id uuid default null,p_debt_amount numeric default null)
returns public.account_income_labels language plpgsql security definer set search_path='' as $$
declare
 u uuid:=(select auth.uid()); m public.transaction_history%rowtype;
 d public.debts%rowtype; receipt public.account_income_labels%rowtype;
begin
 if u is null then raise exception 'Oturum bulunamadı.'; end if;
 if p_kind is null or p_kind<>all(array['salary','receivable','own_transfer','other']) then raise exception 'Geçersiz gelir türü.'; end if;
 select * into m from public.transaction_history where id=p_movement_id and user_id=u for update;
 if not found then raise exception 'Hesap hareketi bulunamadı.'; end if;
 select * into receipt from public.account_income_labels where movement_id=m.id and user_id=u;
 if found then
  if receipt.kind is distinct from p_kind or receipt.debt_id is distinct from p_debt_id or receipt.debt_amount is distinct from p_debt_amount then
   raise exception 'Bu para girişi farklı bir seçimle zaten sınıflandırıldı.';
  end if;
  return receipt;
 end if;
 if m.type<>'transfer' or m.source_table is distinct from 'cards' or m.amount is null or not(m.amount>0 and m.amount<1000000000000)
  or not(m.title ~ ' (para girişi|geldi)$') then raise exception 'Bu kayıt sınıflandırılabilir bir para girişi değil.'; end if;
 if not exists(select 1 from public.cards where id=m.source_id and user_id=u and card_type='banka_karti') then
  raise exception 'Hareketin hesabı bulunamadı.';
 end if;
 if m.source_event_id is not null and exists(select 1 from public.transaction_history where user_id=u and type='debt' and source_event_id=m.source_event_id) then
  raise exception 'Bu SMS zaten bir borç veya alacakla otomatik eşleştirilmiş.';
 end if;
 if p_kind='receivable' then
  if p_debt_amount is null or not(p_debt_amount>0 and p_debt_amount<=m.amount) or p_debt_amount<>round(p_debt_amount,2) then
   raise exception 'Tahsilat tutarı para girişini aşamaz ve kuruş hassasiyetinde olmalı.';
  end if;
  select * into d from public.debts where id=p_debt_id and user_id=u for update;
  if not found or d.direction<>'borç_verdim' or d.status<>'açık' or d.value_type<>'TRY' then raise exception 'Açık TL alacağı bulunamadı.'; end if;
  perform private.settle_personal_debt_internal(u,d.id,m.source_id,p_debt_amount,true,m.occurred_at,'income-match:'||m.id::text);
 elsif p_debt_id is not null or p_debt_amount is not null then raise exception 'Bu sınıflandırmada alacak seçilemez.';
 end if;
 insert into public.account_income_labels(user_id,movement_id,kind,debt_id,debt_amount)
 values(u,m.id,p_kind,p_debt_id,p_debt_amount) returning * into receipt;
 return receipt;
end $$;
revoke all on function public.classify_account_income(uuid,text,uuid,numeric) from public,anon;
grant execute on function public.classify_account_income(uuid,text,uuid,numeric) to authenticated;

create table public.car_service_completions (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 car_id uuid not null, reminder_id uuid not null, title text not null,
 completed_on date not null, odometer_km integer check(odometer_km>=0),
 card_expense_id uuid, car_expense_id uuid, request jsonb not null,
 foreign key(car_id,user_id) references public.cars(id,user_id) on delete cascade,
 foreign key(card_expense_id,user_id) references public.card_expenses(id,user_id) on delete set null (card_expense_id),
 foreign key(car_expense_id,user_id) references public.car_expenses(id,user_id) on delete set null (car_expense_id)
);
create index car_service_completions_user_idx on public.car_service_completions(user_id);
alter table public.car_service_completions enable row level security;
create policy "own completions" on public.car_service_completions for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.car_service_completions from public,anon,authenticated;
grant select on public.car_service_completions to authenticated;

create function public.complete_car_service(p_request_id uuid,p_input jsonb)
returns public.car_service_completions language plpgsql security definer set search_path='' as $$
declare
 u uuid:=(select auth.uid()); r public.car_reminders%rowtype; c public.cars%rowtype;
 receipt public.car_service_completions%rowtype; e public.card_expenses%rowtype;
 completed date; km integer; next_date date; next_km integer; mode text; amount numeric; expense_id uuid; card_expense_id uuid;
begin
 if u is null then raise exception 'Oturum bulunamadı.'; end if;
 if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' or pg_column_size(p_input)>8192 then raise exception 'Geçersiz tamamlama isteği.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request_id::text,0));
 select * into receipt from public.car_service_completions where id=p_request_id and user_id=u;
 if found then
  if receipt.request is distinct from p_input then raise exception 'Bu işlem farklı alanlarla zaten tamamlandı.'; end if;
  return receipt;
 end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k<>all(array['reminderId','expectedUpdatedAt','expectedDueDate','expectedDueKm','completedOn','odometerKm','nextDate','nextKm','expenseMode','existingExpenseId','amount','paymentMethod'])) then raise exception 'Tanınmayan tamamlama alanı.'; end if;
 select * into r from public.car_reminders where id=(p_input->>'reminderId')::uuid and user_id=u for update;
 if not found then raise exception 'Hatırlatıcı bulunamadı veya zaten tamamlandı.'; end if;
 if r.updated_at is distinct from (p_input->>'expectedUpdatedAt')::timestamptz or r.due_date is distinct from (p_input->>'expectedDueDate')::date or r.due_odometer_km is distinct from (p_input->>'expectedDueKm')::integer then raise exception 'Hatırlatıcı değişmiş. Güncel kaydı açıp tekrar dene.'; end if;
 select * into c from public.cars where id=r.car_id and user_id=u for update;
 if not found then raise exception 'Araç bulunamadı.'; end if;
 completed:=(p_input->>'completedOn')::date; km:=(p_input->>'odometerKm')::integer;
 next_date:=(p_input->>'nextDate')::date; next_km:=(p_input->>'nextKm')::integer;
 mode:=p_input->>'expenseMode';
 if completed is null or completed<date '1900-01-01' or completed>private.today_ist() or km<0
  or next_date<=completed or next_km<0 or (km is not null and next_km<=km) then raise exception 'Tamamlama veya sonraki bakım bilgilerini kontrol et.'; end if;
 if mode is null or mode<>all(array['none','card','existing_manual','manual']) then raise exception 'Gider seçimini kontrol et.'; end if;
 if mode='card' then
  select * into e from public.card_expenses where id=(p_input->>'existingExpenseId')::uuid and user_id=u for update;
  if not found or e.status not in ('posted','provision') or (e.car_id is not null and e.car_id<>c.id) then raise exception 'Bu harcama araca bağlanamaz.'; end if;
  update public.card_expenses set car_id=c.id where id=e.id;
  card_expense_id:=e.id;
 elsif mode='existing_manual' then
  select id into expense_id from public.car_expenses where id=(p_input->>'existingExpenseId')::uuid and user_id=u and car_id=c.id for update;
  if not found then raise exception 'Mevcut araç gideri bulunamadı.'; end if;
 elsif mode='manual' then
  amount:=(p_input->>'amount')::numeric;
  if amount is null or not(amount>0 and amount<1000000000000) or amount<>round(amount,2) or coalesce(p_input->>'paymentMethod','')<>all(array['nakit','banka','diger']) then raise exception 'Geçerli gider tutarı ve ödeme yöntemi gir.'; end if;
  insert into public.car_expenses(user_id,car_id,spent_at,amount,category,payment_method,description,odometer_km)
  values(u,c.id,completed,amount,case r.kind when 'bakim' then 'Bakım/Servis' when 'mtv' then 'MTV/Vergi' when 'sigorta' then 'Sigorta/Kasko' when 'kasko' then 'Sigorta/Kasko' when 'muayene' then 'Muayene' when 'lastik' then 'Lastik' else 'Diğer' end,p_input->>'paymentMethod',r.title,km)
  returning id into expense_id;
 end if;
 if km is not null and (c.current_odometer_km is null or km>c.current_odometer_km) then update public.cars set current_odometer_km=km where id=c.id; end if;
 if next_date is not null or next_km is not null then
  update public.car_reminders set due_date=next_date,due_odometer_km=next_km where id=r.id;
 else delete from public.car_reminders where id=r.id;
 end if;
 insert into public.car_service_completions(id,user_id,car_id,reminder_id,title,completed_on,odometer_km,card_expense_id,car_expense_id,request)
 values(p_request_id,u,c.id,r.id,r.title,completed,km,card_expense_id,expense_id,p_input) returning * into receipt;
 return receipt;
end $$;
revoke all on function public.complete_car_service(uuid,jsonb) from public,anon;
grant execute on function public.complete_car_service(uuid,jsonb) to authenticated;

-- The existing transactional restore owns reset and all parents. These children
-- restore last; composite owner FKs reject cross-account backup links.
alter function public.restore_user_finance_data_tx(jsonb) rename to restore_user_finance_data_tx_without_linked_workflows;
revoke all on function public.restore_user_finance_data_tx_without_linked_workflows(jsonb) from public,anon,authenticated;
create function public.restore_user_finance_data_tx(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid()); t text; rows jsonb; result jsonb; n integer;
begin
 if u is null then raise exception 'Oturum bulunamadı.'; end if;
 if coalesce(p_payload->>'schema','')<>'financeproject-v2' then raise exception 'Tanınmayan yedek şeması.'; end if;
 if jsonb_typeof(p_payload->'tables') is distinct from 'object' then raise exception 'Yedek gövdesi (tables) eksik ya da nesne değil.'; end if;
 if pg_column_size(p_payload)>32*1024*1024 then raise exception 'Yedek dosyası beklenmedik kadar büyük (32 MB sınırı).'; end if;
 foreach t in array array['account_income_labels','car_service_completions'] loop
  rows:=p_payload->'tables'->t;
  if rows is not null then
   if jsonb_typeof(rows)<>'array' then raise exception 'Akış kayıtları liste olmalı.'; end if;
   if exists(select 1 from jsonb_array_elements(rows) r where jsonb_typeof(r)<>'object') then raise exception 'Geçersiz akış kaydı.'; end if;
   if exists(select 1 from jsonb_array_elements(rows) r,jsonb_object_keys(r) k where not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=('public.'||t)::regclass and a.attname=k and a.attnum>0 and not a.attisdropped)) then raise exception 'Akış kaydında tanınmayan kolon var.'; end if;
  end if;
 end loop;
 result:=public.restore_user_finance_data_tx_without_linked_workflows(jsonb_set(p_payload,'{tables}',(p_payload->'tables')-'account_income_labels'-'car_service_completions'));
 insert into public.account_income_labels
 select (jsonb_populate_record(null::public.account_income_labels,jsonb_build_object('id',gen_random_uuid(),'created_at',now(),'updated_at',now())||r||jsonb_build_object('user_id',u))).*
 from jsonb_array_elements(coalesce(p_payload->'tables'->'account_income_labels','[]'::jsonb)) r;
 get diagnostics n=row_count;
 result:=jsonb_set(result,'{tables,account_income_labels}',to_jsonb(n),true);
 insert into public.car_service_completions
 select (jsonb_populate_record(null::public.car_service_completions,jsonb_build_object('id',gen_random_uuid(),'created_at',now(),'updated_at',now())||r||jsonb_build_object('user_id',u))).*
 from jsonb_array_elements(coalesce(p_payload->'tables'->'car_service_completions','[]'::jsonb)) r;
 get diagnostics n=row_count;
 result:=jsonb_set(result,'{tables,car_service_completions}',to_jsonb(n),true);
 return result;
end $$;
revoke all on function public.restore_user_finance_data_tx(jsonb) from public,anon;
grant execute on function public.restore_user_finance_data_tx(jsonb) to authenticated;
