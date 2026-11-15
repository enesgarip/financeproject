begin;
insert into auth.users(id,email) values ('22222222-2222-4222-8222-222222222222','optional-account-other@example.test');
insert into public.debts(id,user_id,person_name,direction,value_type,amount,estimated_value_try,status)
values ('d0000000-0000-4000-8000-000000000099','22222222-2222-4222-8222-222222222222','Başka kişi','borç_verdim','TRY',1000,1000,'açık');
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
declare
  u uuid := '11111111-1111-1111-1111-111111111111';
  d uuid;
  direction_value text;
  request_id uuid;
  args jsonb;
  baseline_balances jsonb;
  ledger_count bigint;
  row_value public.debts;
  failed boolean;
begin
  select jsonb_object_agg(id,current_balance) into baseline_balances from public.cards where user_id=u;
  select count(*) into ledger_count from public.account_ledger where user_id=u;
  foreach direction_value in array array['borç_verdim','borç_aldım'] loop
    insert into public.debts(user_id,person_name,direction,value_type,amount,estimated_value_try,auto_valued,status)
      values(u,'Hesapsız test',direction_value,'TRY',1000,1000,false,'açık') returning id into d;
    request_id := gen_random_uuid();
    args := jsonb_build_object('p_debt_id',d,'p_account_card_id',null,'p_amount',400,'p_skip_account_move',true);
    perform public.submit_finance_payment(request_id,'settle_personal_debt',args);
    perform public.submit_finance_payment(request_id,'settle_personal_debt',args);
    select * into row_value from public.debts where id=d;
    if row_value.status <> 'açık' or row_value.amount <> 600 or row_value.estimated_value_try <> 600 then
      raise exception 'Hesapsız kısmi ödeme/retry yanlış: %',row_value;
    end if;
    if (select count(*) from public.transaction_history where source_table='debts' and source_id=d and type='debt') <> 1 then
      raise exception 'Retry tek kişisel geçmiş olayı oluşturmalı';
    end if;
    failed := false;
    begin
      perform public.submit_finance_payment(request_id,'settle_personal_debt',args || '{"p_amount":200}');
    exception when others then failed := true; end;
    if not failed then raise exception 'Farklı tutarla aynı makbuz reddedilmeli'; end if;
    -- Hesaba işleme istenirse null hesap kabul edilmemeli.
    failed := false;
    begin
      perform public.settle_personal_debt(d,null,100,false);
    exception when others then failed := true; end;
    if not failed then raise exception 'Hesap etkisi açıkken hesap zorunlu'; end if;
    -- Skip yolunda da gönderilmiş geçersiz bir hesap sessizce yoksayılmaz.
    failed := false;
    begin
      perform public.settle_personal_debt(d,'f0000000-0000-4000-8000-000000000099',100,true);
    exception when others then failed := true; end;
    if not failed then raise exception 'Geçersiz hesap reddedilmeli'; end if;
    row_value := public.settle_personal_debt(d,null,600,true);
    if row_value.status <> 'kapandı' then raise exception 'Hesapsız tam ödeme kapatmalı'; end if;
    if (select count(*) from public.transaction_history where source_table='debts' and source_id=d and type='debt') <> 2
       or exists(select 1 from public.transaction_history where source_table='debts' and source_id=d and (note is null or note not like '%Hesap hareketi oluşturmadan%')) then
      raise exception 'Hesapsız ödeme geçmişi eksik veya yanlış';
    end if;
  end loop;
  failed := false;
  begin
    perform public.settle_personal_debt('d0000000-0000-4000-8000-000000000099',null,100,true);
  exception when others then failed := true; end;
  if not failed then raise exception 'Başka kullanıcının borcu reddedilmeli'; end if;
  if (select jsonb_object_agg(id,current_balance) from public.cards where user_id=u) is distinct from baseline_balances
     or (select count(*) from public.account_ledger where user_id=u) <> ledger_count then
    raise exception 'Hesapsız kayıt bakiye/hesap ledger yazmamalı';
  end if;
  raise notice 'Hesapsız kişisel ödeme/tahsilat: tam, kısmi, retry, zorunlu hesap ve sahiplik OK';
end $$;
rollback;
