-- Faz D2: Karma birikim hedefinde ana satırın sayaçları bileşenlerden türetilir.
--
-- savings_goals.target_amount = bileşen sayısı, current_amount = hedefine ulaşan
-- bileşen sayısı. İkisi de tamamen savings_goal_components'tan türetilebilir ama
-- upsert_savings_goal client'ın gönderdiği değeri sorgusuz yazıyordu: bileşenler
-- ile ana satır sessizce ayrışabiliyordu (client hesabı atlarsa, eski bir sürüm
-- yazarsa ya da bileşenler başka bir yoldan değişirse).
--
-- Artık composite hedefte p_target_amount / p_current_amount YOK SAYILIR ve
-- sayaçlar p_components'tan hesaplanır. "Hedefine ulaştı" tanımı TS ikizi
-- savingsGoalTargetReached ile aynıdır: hedef > 0 ve eksik kalan ≤ 1 kuruş
-- (exceedsTL'in 1 kuruşluk grace'i).
--
-- Composite OLMAYAN hedeflerde davranış değişmez: orada current/target gerçek
-- TL ya da gram cinsinden kullanıcı girdisidir, türetilebilir değildir.

create or replace function public.upsert_savings_goal(
  p_goal_id uuid default null,
  p_name text default null,
  p_value_type text default 'TRY',
  p_target_amount numeric default 0,
  p_current_amount numeric default 0,
  p_estimated_value_try numeric default null,
  p_auto_valued boolean default false,
  p_target_date date default null,
  p_status text default 'active',
  p_note text default null,
  p_is_composite boolean default false,
  p_components jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_goal_id uuid;
  v_comp jsonb;
  v_target numeric := p_target_amount;
  v_current numeric := p_current_amount;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  -- Karma hedefte sayaçlar bileşenlerin kendisinden gelir; client'ın gönderdiği
  -- değere güvenilmez (Faz D2).
  if p_is_composite then
    select
      count(*),
      count(*) filter (
        where coalesce((c->>'target_amount')::numeric, 0) > 0
          and coalesce((c->>'target_amount')::numeric, 0)
              - coalesce((c->>'current_amount')::numeric, 0) <= 0.01
      )
    into v_target, v_current
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) as c;
  end if;

  if p_goal_id is not null then
    -- Güncelleme
    update public.savings_goals
    set name = coalesce(p_name, name),
        value_type = p_value_type,
        target_amount = v_target,
        current_amount = v_current,
        estimated_value_try = p_estimated_value_try,
        auto_valued = p_auto_valued,
        target_date = p_target_date,
        status = p_status,
        note = p_note,
        updated_at = now()
    where id = p_goal_id
      and user_id = v_user_id;

    if not found then
      raise exception 'Hedef bulunamadı.';
    end if;

    v_goal_id := p_goal_id;
  else
    -- Yeni kayıt
    insert into public.savings_goals (user_id, name, value_type, target_amount, current_amount, estimated_value_try, auto_valued, target_date, status, note)
    values (v_user_id, p_name, p_value_type, v_target, v_current, p_estimated_value_try, p_auto_valued, p_target_date, p_status, p_note)
    returning id into v_goal_id;
  end if;

  -- Bileşen yönetimi
  if p_is_composite then
    delete from public.savings_goal_components
    where goal_id = v_goal_id
      and user_id = v_user_id;

    for v_comp in select * from jsonb_array_elements(p_components)
    loop
      insert into public.savings_goal_components (user_id, goal_id, label, value_type, target_amount, current_amount, sort_order)
      values (
        v_user_id,
        v_goal_id,
        v_comp->>'label',
        v_comp->>'value_type',
        (v_comp->>'target_amount')::numeric,
        (v_comp->>'current_amount')::numeric,
        coalesce((v_comp->>'sort_order')::int, 0)
      );
    end loop;
  elsif p_goal_id is not null then
    -- Composite'den basit tipe geçiş: eski bileşenleri temizle
    delete from public.savings_goal_components
    where goal_id = v_goal_id
      and user_id = v_user_id;
  end if;

  return v_goal_id;
end;
$$;

revoke execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb) from public;
revoke execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb) from anon;
grant execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb) to authenticated;

-- Halihazırda ayrışmış olabilecek karma hedefleri bileşenlerinden onar. Bu
-- veri (mutabakat farkının aksine) kayıp değil, türetilebilir olduğu için
-- onarım güvenli ve tam.
update public.savings_goals g
set target_amount = t.total,
    current_amount = t.reached,
    updated_at = now()
from (
  select
    goal_id,
    count(*) as total,
    count(*) filter (
      where target_amount > 0 and target_amount - current_amount <= 0.01
    ) as reached
  from public.savings_goal_components
  group by goal_id
) t
where g.id = t.goal_id
  and g.value_type = 'composite'
  and (g.target_amount is distinct from t.total or g.current_amount is distinct from t.reached);

-- Bileşeni hiç kalmamış karma hedef yukarıdaki join'e girmez; sayacı sıfırlanır
-- ki "3 bileşenden 1'i tamam" gibi dayanaksız bir sayı ekranda kalmasın.
update public.savings_goals g
set target_amount = 0,
    current_amount = 0,
    updated_at = now()
where g.value_type = 'composite'
  and not exists (
    select 1 from public.savings_goal_components c where c.goal_id = g.id
  )
  and (g.target_amount <> 0 or g.current_amount <> 0);
