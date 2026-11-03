-- Ödeme yanıtı kaybolsa bile aynı kullanıcı niyetini bir kez uygula.
-- Para/ledger yazmasını mevcut domain RPC'leri yapar; makbuz aynı transaction'dadır.
create table private.finance_payment_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_hash bytea not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
revoke all on private.finance_payment_requests from public, anon, authenticated;

create function public.submit_finance_payment(p_request_id uuid, p_method text, p_args jsonb)
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
  -- Reset/restore ile aynı kullanıcı kilidi: silme ve tekrar yarışı oluşmasın.
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
    else raise exception 'Bu ödeme türü desteklenmiyor.';
  end case;
  insert into private.finance_payment_requests(user_id, request_id, request_hash)
    values(v_user, p_request_id, v_hash);
end;
$$;
revoke all on function public.submit_finance_payment(uuid, text, jsonb) from public, anon;
grant execute on function public.submit_finance_payment(uuid, text, jsonb) to authenticated;

-- Yalnız opak kimlik + hash tutulur; tutar/hesap/kişi alanları saklanmaz.
-- Reset/restore hash'i silmez: başka sekmedeki kayıp yanıt, geri yüklenmiş
-- aynı kaynak kimliğine eski ödemeyi yeniden uygulamamalı. Auth silinince cascade.
