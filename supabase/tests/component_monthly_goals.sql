begin;
insert into auth.users(id,email) values
 ('7a180000-0000-4000-8000-000000000001','component-own@local.test'),
 ('7a180000-0000-4000-8000-000000000002','component-other@local.test');
insert into public.savings_goals(id,user_id,name,value_type,target_amount,current_amount) values
 ('7a180000-0000-4000-8000-000000000011','7a180000-0000-4000-8000-000000000001','LOCAL-E2E-KARMA','composite',0,0),
 ('7a180000-0000-4000-8000-000000000012','7a180000-0000-4000-8000-000000000002','LOCAL-E2E-OTHER','composite',0,0);
insert into public.savings_goal_components(id,user_id,goal_id,label,value_type,target_amount,current_amount,sort_order) values
 ('7a180000-0000-4000-8000-000000000021','7a180000-0000-4000-8000-000000000001','7a180000-0000-4000-8000-000000000011','Gram','gram_altin',100,0,0),
 ('7a180000-0000-4000-8000-000000000022','7a180000-0000-4000-8000-000000000001','7a180000-0000-4000-8000-000000000011','Çeyrek','ceyrek_altin',20,0,1),
 ('7a180000-0000-4000-8000-000000000023','7a180000-0000-4000-8000-000000000002','7a180000-0000-4000-8000-000000000012','Başkası','gram_altin',100,0,0);
insert into public.savings_goal_component_monthly_plans(user_id,goal_id,component_id,effective_month,value_type,target_amount,source)
 values ('7a180000-0000-4000-8000-000000000002','7a180000-0000-4000-8000-000000000012','7a180000-0000-4000-8000-000000000023','2026-09-01','gram_altin',5,'manual');
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a180000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
 v_user uuid := '7a180000-0000-4000-8000-000000000001';
 v_goal uuid := '7a180000-0000-4000-8000-000000000011';
 v_gram uuid := '7a180000-0000-4000-8000-000000000021';
 v_quarter uuid := '7a180000-0000-4000-8000-000000000022';
 v_other uuid := '7a180000-0000-4000-8000-000000000023';
 v_snapshot jsonb;
 v_payload jsonb;
 v_report jsonb;
begin
 v_snapshot := public.fetch_finance_snapshot(now()-interval '24 months',(current_date-interval '24 months')::date,120);
 insert into public.savings_goal_component_monthly_plans(user_id,goal_id,component_id,effective_month,value_type,target_amount,source,automatic_from) values
  (v_user,v_goal,v_gram,'2026-09-01','gram_altin',5,'gold_buys','2026-11-01'),
  (v_user,v_goal,v_quarter,'2026-09-01','ceyrek_altin',1,'gold_buys','2026-11-01');
 insert into public.savings_goal_component_monthly_plans(user_id,goal_id,component_id,effective_month,value_type,target_amount,source)
 values (v_user,v_goal,v_gram,'2026-11-01','gram_altin',10,'manual')
 on conflict(component_id,effective_month) do update set target_amount=excluded.target_amount;
 insert into public.savings_goal_component_monthly_entries(user_id,goal_id,component_id,month,amount) values
  (v_user,v_goal,v_gram,'2026-11-01',0), (v_user,v_goal,v_quarter,'2026-11-01',1);
 insert into public.savings_goal_component_monthly_entries(user_id,goal_id,component_id,month,amount)
 values (v_user,v_goal,v_gram,'2026-11-01',0.005)
 on conflict(component_id,month) do update set amount=excluded.amount;
 if (select count(*) from public.savings_goal_component_monthly_plans) <> 3 then raise exception 'Bileşen planları veya RLS hatalı.'; end if;
 if (select amount from public.savings_goal_component_monthly_entries where component_id=v_quarter) <> 1
  or (select amount from public.savings_goal_component_monthly_entries where component_id=v_gram) <> 0.005 then raise exception 'Bileşen miktarları karıştı.'; end if;
 if not exists(select 1 from public.savings_goal_component_monthly_plans where component_id=v_gram and effective_month='2026-09-01' and target_amount=5) then raise exception 'Eski plan değişti.'; end if;
 if public.fetch_finance_snapshot(now()-interval '24 months',(current_date-interval '24 months')::date,120) is distinct from v_snapshot then raise exception 'Aylık takip finansal durumu değiştirdi.'; end if;
 begin
  insert into public.savings_goal_component_monthly_entries(user_id,goal_id,component_id,month,amount) values (v_user,v_goal,v_other,'2026-11-01',1);
  raise exception 'Başka hedefin bileşenine bağlanıldı.';
 exception when foreign_key_violation then null; end;
 begin
  insert into public.savings_goal_component_monthly_plans(user_id,goal_id,component_id,effective_month,value_type,target_amount,source)
  values ('7a180000-0000-4000-8000-000000000002','7a180000-0000-4000-8000-000000000012',v_other,'2026-11-01','gram_altin',5,'manual');
  raise exception 'Başka kullanıcı adına yazıldı.';
 exception when insufficient_privilege then null; end;
 begin
  update public.savings_goal_component_monthly_entries set amount=-1 where component_id=v_gram;
  raise exception 'Negatif miktar kabul edildi.';
 exception when check_violation then null; end;
 begin
  update public.savings_goal_component_monthly_plans set target_amount='NaN'::numeric where component_id=v_gram;
  raise exception 'NaN kabul edildi.';
 exception when check_violation then null; end;

 v_payload := jsonb_build_object('schema','financeproject-v2','tables',jsonb_build_object(
  'savings_goals',(select jsonb_agg(to_jsonb(g)) from public.savings_goals g),
  'savings_goal_components',(select jsonb_agg(to_jsonb(c)) from public.savings_goal_components c),
  'savings_goal_component_monthly_plans',(select jsonb_agg(to_jsonb(p)) from public.savings_goal_component_monthly_plans p),
  'savings_goal_component_monthly_entries',(select jsonb_agg(to_jsonb(e)) from public.savings_goal_component_monthly_entries e)));
 v_report := public.restore_user_finance_data_tx(v_payload);
 if (v_report->'tables'->>'savings_goal_component_monthly_plans')::int <> 3
  or (v_report->'tables'->>'savings_goal_component_monthly_entries')::int <> 2 then raise exception 'Restore bileşen geçmişini eksik yükledi.'; end if;
 begin
  perform public.restore_user_finance_data_tx(jsonb_set(v_payload,'{tables,savings_goal_component_monthly_entries,0,component_id}',to_jsonb(v_other::text)));
  raise exception 'Restore başka bileşene bağlandı.';
 exception when foreign_key_violation then null; end;
 if (select count(*) from public.savings_goal_component_monthly_entries) <> 2 then raise exception 'Başarısız restore mevcut veriyi sildi.'; end if;
 if has_function_privilege('authenticated','public.restore_user_finance_data_tx_without_component_monthly(jsonb)','execute') then raise exception 'İç restore sarmalı açık.'; end if;
 delete from public.savings_goal_components where id=v_gram;
 if exists(select 1 from public.savings_goal_component_monthly_plans where component_id=v_gram)
  or exists(select 1 from public.savings_goal_component_monthly_entries where component_id=v_gram) then raise exception 'Silinen bileşenin geçmişi kaldı.'; end if;
 if (select count(*) from public.savings_goal_component_monthly_entries) <> 1 then raise exception 'Diğer bileşen silindi.'; end if;
 perform public.reset_user_finance_data();
 if exists(select 1 from public.savings_goal_component_monthly_plans) or exists(select 1 from public.savings_goal_component_monthly_entries) then raise exception 'Reset bileşen geçmişini bırakmış.'; end if;
 perform public.restore_user_finance_data_tx('{"schema":"financeproject-v2","tables":{}}'::jsonb);
 raise notice 'GECTI: karma aylık plan, bileşen izolasyonu, RLS/FK, miktar hassasiyeti, sürümler, finansal etkisizlik, restore rollback ve cascade reset.';
end;
$$;
rollback;
