-- Hedef günlük fotoğrafı: upsert idempotent, negatif reddi, RLS ve cascade.
--
-- Riskler:
--  1) Aynı güne ikinci yazım çift satır üretirse tempo hesabı (PR-4) günü iki
--     kez sayar; unique (goal_id, snapshot_date) + upsert tek noktaya indirmeli.
--  2) reset_user_finance_data bu tabloyu saymaz — hedef silinince fotoğrafların
--     cascade ile gittiği garanti edilmeli, yoksa restore artık satır bırakır.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_goal uuid;
  v_count int;
  v_amount numeric;
begin
  insert into public.savings_goals (user_id, name, target_amount, current_amount, status)
  values (v_user, 'Fotoğraf testi', 100000, 0, 'active')
  returning id into v_goal;

  -- 1) Aynı (hedef, gün) ikinci yazım güncelleme olur (client'ın upsert yolu).
  insert into public.savings_goal_snapshots (user_id, goal_id, snapshot_date, amount)
  values (v_user, v_goal, current_date, 1000);
  insert into public.savings_goal_snapshots (user_id, goal_id, snapshot_date, amount)
  values (v_user, v_goal, current_date, 2500)
  on conflict (goal_id, snapshot_date) do update set amount = excluded.amount;

  select count(*), max(amount) into v_count, v_amount
  from public.savings_goal_snapshots
  where goal_id = v_goal and snapshot_date = current_date;
  if v_count <> 1 or v_amount <> 2500 then
    raise exception 'BAŞARISIZ: upsert tek satıra inmedi (% satır, tutar %).', v_count, v_amount;
  end if;

  -- 2) Negatif birikim reddedilir.
  begin
    insert into public.savings_goal_snapshots (user_id, goal_id, snapshot_date, amount)
    values (v_user, v_goal, current_date - 1, -5);
    raise exception 'BAŞARISIZ: negatif tutar kabul edildi.';
  exception
    when check_violation then null;
  end;
end $$;

-- 3) Başka kullanıcı fotoğrafları göremez (RLS own-row).
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.savings_goal_snapshots;
  if v_count <> 0 then
    raise exception 'BAŞARISIZ: RLS başka kullanıcının fotoğrafını gösterdi (% satır).', v_count;
  end if;
end $$;

-- 4) Hedef silinince fotoğrafları da gider (cascade) — reset RPC buna güvenir.
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  delete from public.savings_goals where name = 'Fotoğraf testi';
  select count(*) into v_count from public.savings_goal_snapshots;
  if v_count <> 0 then
    raise exception 'BAŞARISIZ: cascade fotoğrafları silmedi (% satır).', v_count;
  end if;

  raise notice 'savings_goal_snapshots: tüm kontroller geçti';
end $$;

rollback;
