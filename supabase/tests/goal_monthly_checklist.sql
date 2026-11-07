-- Yeni özelliğin yazma yolu RLS'li tablo CRUD'udur; finansal hareket RPC'si yoktur.
begin;
insert into auth.users(id,email) values
 ('7a170000-0000-4000-8000-000000000001','monthly-own@local.test'),
 ('7a170000-0000-4000-8000-000000000002','monthly-other@local.test');
insert into public.savings_goals(id,user_id,name,value_type,target_amount,current_amount) values
 ('7a170000-0000-4000-8000-000000000011','7a170000-0000-4000-8000-000000000001','LOCAL-E2E-MONTHLY','gram_altin',100,0),
 ('7a170000-0000-4000-8000-000000000012','7a170000-0000-4000-8000-000000000002','LOCAL-E2E-OTHER','gram_altin',100,0);
insert into public.savings_goal_monthly_plans(user_id,goal_id,effective_month,value_type,target_amount,source)
 values ('7a170000-0000-4000-8000-000000000002','7a170000-0000-4000-8000-000000000012','2026-09-01','gram_altin',5,'manual');
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a170000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
 v_user uuid := '7a170000-0000-4000-8000-000000000001';
 v_goal uuid := '7a170000-0000-4000-8000-000000000011';
 v_other_goal uuid := '7a170000-0000-4000-8000-000000000012';
 v_snapshot jsonb;
 v_payload jsonb;
 v_report jsonb;
begin
 v_snapshot := public.fetch_finance_snapshot(now()-interval '24 months',(current_date-interval '24 months')::date,120);
 insert into public.savings_goal_monthly_plans(user_id,goal_id,effective_month,value_type,target_amount,source,automatic_from)
 values (v_user,v_goal,'2026-09-01','gram_altin',5,'gold_buys','2026-11-01');
 insert into public.savings_goal_monthly_plans(user_id,goal_id,effective_month,value_type,target_amount,source,automatic_from)
 values (v_user,v_goal,'2026-11-01','gram_altin',10,'gold_buys','2026-11-01');
 insert into public.savings_goal_monthly_entries(user_id,goal_id,month,amount) values (v_user,v_goal,'2026-09-01',0);
 insert into public.savings_goal_monthly_entries(user_id,goal_id,month,amount) values (v_user,v_goal,'2026-10-01',5)
 on conflict(goal_id,month) do update set amount = excluded.amount;
 if (select count(*) from public.savings_goal_monthly_plans) <> 2 then raise exception 'Plan geçmişi veya RLS hatalı.'; end if;
 if not exists(select 1 from public.savings_goal_monthly_plans where effective_month='2026-09-01' and target_amount=5) then raise exception 'Eski hedef değişti.'; end if;
 if public.fetch_finance_snapshot(now()-interval '24 months',(current_date-interval '24 months')::date,120) is distinct from v_snapshot then
  raise exception 'Aylık takip finansal değerleri değiştirdi.';
 end if;
 begin
  insert into public.savings_goal_monthly_entries(user_id,goal_id,month,amount) values (v_user,v_other_goal,'2026-09-01',5);
  raise exception 'Başkasının hedefine bağlanıldı.';
 exception when foreign_key_violation then null; end;
 begin
  insert into public.savings_goal_monthly_plans(user_id,goal_id,effective_month,value_type,target_amount,source)
  values ('7a170000-0000-4000-8000-000000000002',v_other_goal,'2026-10-01','gram_altin',5,'manual');
  raise exception 'RLS başka kullanıcı adına yazmaya izin verdi.';
 exception when insufficient_privilege then null; end;
 begin
  update public.savings_goal_monthly_entries set amount=-1 where goal_id=v_goal;
  raise exception 'Negatif miktar kabul edildi.';
 exception when check_violation then null; end;
 begin
  update public.savings_goal_monthly_entries set amount='NaN'::numeric where goal_id=v_goal;
  raise exception 'NaN kabul edildi.';
 exception when check_violation then null; end;
 begin
  update public.savings_goal_monthly_plans set effective_month='2026-09-02' where goal_id=v_goal;
  raise exception 'Ayın ilk günü olmayan tarih kabul edildi.';
 exception when check_violation then null; end;

 v_payload := jsonb_build_object('schema','financeproject-v2','tables',jsonb_build_object(
  'savings_goals',(select jsonb_agg(to_jsonb(g)) from public.savings_goals g),
  'savings_goal_monthly_plans',(select jsonb_agg(to_jsonb(p)) from public.savings_goal_monthly_plans p),
  'savings_goal_monthly_entries',(select jsonb_agg(to_jsonb(e)) from public.savings_goal_monthly_entries e)));
 v_report := public.restore_user_finance_data_tx(v_payload);
 if (v_report->'tables'->>'savings_goal_monthly_plans')::int <> 2
  or (v_report->'tables'->>'savings_goal_monthly_entries')::int <> 2 then raise exception 'Restore aylık geçmişi eksik yükledi.'; end if;
 if not exists(select 1 from public.savings_goal_monthly_entries where goal_id=v_goal and month='2026-09-01' and amount=0) then raise exception 'Sıfır kayıt restore edilmedi.'; end if;
 begin
  perform public.restore_user_finance_data_tx(jsonb_set(v_payload,'{tables,savings_goal_monthly_entries,0,goal_id}',to_jsonb(v_other_goal::text)));
  raise exception 'Restore başkasının hedefine bağlandı.';
 exception when foreign_key_violation then null; end;
 if (select count(*) from public.savings_goal_monthly_entries) <> 2 then raise exception 'Başarısız restore mevcut veriyi sildi.'; end if;
 if has_function_privilege('authenticated','public.restore_user_finance_data_tx_without_monthly_goals(jsonb)','execute') then raise exception 'İç restore sarmalı açık.'; end if;
 perform public.reset_user_finance_data();
 if exists(select 1 from public.savings_goal_monthly_entries) or exists(select 1 from public.savings_goal_monthly_plans) then raise exception 'Reset aylık geçmişi bırakmış.'; end if;
 perform public.restore_user_finance_data_tx('{"schema":"financeproject-v2","tables":{}}'::jsonb);
 raise notice 'GECTI: aylık hedef CRUD, RLS, sahiplik FK, geçmiş, finansal etkisizlik, restore rollback ve reset.';
end;
$$;
rollback;
