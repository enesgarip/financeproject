-- A recorded bank movement can settle an obligation without moving money again.
create function private.personal_debt_sms_direction(m public.transaction_history)
returns text language sql immutable set search_path = '' as $$
  select case
    when m.type = 'transfer' and m.source_table = 'cards'
      and m.note = 'SMS otomasyonu ile kaydedildi.' and m.amount > 0
    then case when m.title like '% geldi' then 'borç_verdim'
              when m.title like '% gonderimi' then 'borç_aldım' end
  end;
$$;
revoke all on function private.personal_debt_sms_direction(public.transaction_history) from public, anon, authenticated;

create function private.personal_debt_sms_event_id(m public.transaction_history)
returns text language sql immutable set search_path = '' as $$
  select coalesce(m.source_event_id, 'sms-debt-match:' || m.id::text);
$$;
revoke all on function private.personal_debt_sms_event_id(public.transaction_history) from public, anon, authenticated;

create function public.list_personal_debt_sms_movements(p_debt_id uuid)
returns table (id uuid, account_name text, title text, amount numeric, occurred_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, c.card_name, m.title, m.amount, m.occurred_at
  from public.debts d
  join public.transaction_history m on m.user_id = d.user_id
    and private.personal_debt_sms_direction(m) = d.direction
  join public.cards c on c.id = m.source_id and c.user_id = d.user_id and c.card_type = 'banka_karti'
  where d.id = p_debt_id and d.user_id = (select auth.uid()) and d.status = 'açık' and d.value_type = 'TRY'
    and not exists (select 1 from public.account_income_labels l where l.movement_id = m.id)
    and not exists (
      select 1 from public.transaction_history h
      where h.user_id = d.user_id and h.type = 'debt' and h.source_table = 'debts'
        and h.source_event_id = private.personal_debt_sms_event_id(m)
    )
  order by m.occurred_at desc, m.id desc
  limit 30;
$$;
revoke all on function public.list_personal_debt_sms_movements(uuid) from public, anon;
grant execute on function public.list_personal_debt_sms_movements(uuid) to authenticated;

create function private.link_personal_debt_sms_movement(p_user_id uuid, p_debt_id uuid, p_movement_id uuid, p_amount numeric)
returns void language plpgsql set search_path = '' as $$
declare
  m public.transaction_history%rowtype;
  d public.debts%rowtype;
  v_direction text;
  v_event_id text;
begin
  select * into m from public.transaction_history where id = p_movement_id and user_id = p_user_id for update;
  v_direction := private.personal_debt_sms_direction(m);
  if not found or v_direction is null then raise exception 'SMS hesap hareketi bulunamadı.'; end if;
  if p_amount is null or not (p_amount > 0 and p_amount <= m.amount) or p_amount <> round(p_amount, 2) then
    raise exception 'Kaydedilecek tutar SMS hareketinin tutarını aşamaz ve kuruş hassasiyetinde olmalı.';
  end if;

  select * into d from public.debts where id = p_debt_id and user_id = p_user_id for update;
  if not found or d.status <> 'açık' or d.value_type <> 'TRY' or d.direction <> v_direction then
    raise exception 'SMS hareketinin yönüne uygun açık TL borcu veya alacağı bulunamadı.';
  end if;

  if v_direction = 'borç_verdim' then
    perform public.classify_account_income(m.id, 'receivable', d.id, p_amount);
    return;
  end if;

  v_event_id := private.personal_debt_sms_event_id(m);
  if exists (
    select 1 from public.transaction_history h
    where h.user_id = p_user_id and h.type = 'debt' and h.source_table = 'debts' and h.source_event_id = v_event_id
  ) then
    raise exception 'Bu SMS hareketi zaten bir borç kaydına bağlanmış.';
  end if;
  perform private.settle_personal_debt_internal(p_user_id, d.id, m.source_id, p_amount, true, m.occurred_at, v_event_id);
end;
$$;
revoke all on function private.link_personal_debt_sms_movement(uuid, uuid, uuid, numeric) from public, anon, authenticated;

-- Keep the existing request hash and receipt contract for pending payments.
create or replace function public.submit_finance_payment(p_request_id uuid, p_method text, p_args jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_previous private.finance_payment_requests%rowtype;
  v_hash bytea;
begin
  if v_user is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_request_id is null or p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'Ödeme işlem kimliği ve alanları gerekli.';
  end if;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('method',p_method,'args',p_args)::text, 'UTF8'));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 1647595321));
  select * into v_previous from private.finance_payment_requests
    where user_id = v_user and request_id = p_request_id;
  if found then
    if v_previous.request_hash <> v_hash then
      raise exception 'Bu işlem kimliği farklı bir ödeme için kullanılamaz.';
    end if;
    return;
  end if;
  case p_method
    when 'pay_payment' then
      perform public.pay_payment((p_args->>'p_payment_id')::uuid, (p_args->>'p_source_card_id')::uuid,
        (p_args->>'p_paid_amount')::numeric, (p_args->>'p_paid_at')::date,
        coalesce((p_args->>'p_outside_accounts')::boolean, false));
    when 'pay_card_statement' then
      perform public.pay_card_statement((p_args->>'p_statement_id')::uuid, (p_args->>'p_source_card_id')::uuid,
        coalesce((p_args->>'p_skip_source_debit')::boolean, false), (p_args->>'p_amount')::numeric);
    when 'pay_card_debt' then
      perform public.pay_card_debt((p_args->>'p_card_id')::uuid, (p_args->>'p_source_card_id')::uuid,
        (p_args->>'p_amount')::numeric, coalesce((p_args->>'p_skip_source_debit')::boolean, false));
    when 'pay_loan_installment' then
      perform public.pay_loan_installment((p_args->>'p_installment_id')::uuid,
        (p_args->>'p_source_card_id')::uuid, (p_args->>'p_paid_at')::date);
    when 'settle_personal_debt' then
      perform public.settle_personal_debt((p_args->>'p_debt_id')::uuid, (p_args->>'p_account_card_id')::uuid,
        (p_args->>'p_amount')::numeric, coalesce((p_args->>'p_skip_account_move')::boolean, false));
    when 'link_personal_debt_sms_movement' then
      perform private.link_personal_debt_sms_movement(v_user, (p_args->>'p_debt_id')::uuid,
        (p_args->>'p_movement_id')::uuid, (p_args->>'p_amount')::numeric);
    else raise exception 'Bu ödeme türü desteklenmiyor.';
  end case;
  insert into private.finance_payment_requests(user_id, request_id, request_hash)
    values(v_user, p_request_id, v_hash);
end;
$$;
