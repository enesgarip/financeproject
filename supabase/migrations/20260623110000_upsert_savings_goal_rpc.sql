-- Birikim hedefi oluşturma/güncelleme + bileşen yönetimini tek transaction'da yapar.
-- Önceki client-side sıralı yazma (goal insert → component delete → component insert)
-- transaction gap'ini kapatır.

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
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_goal_id is not null then
    -- Güncelleme
    update public.savings_goals
    set name = coalesce(p_name, name),
        value_type = p_value_type,
        target_amount = p_target_amount,
        current_amount = p_current_amount,
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
    values (v_user_id, p_name, p_value_type, p_target_amount, p_current_amount, p_estimated_value_try, p_auto_valued, p_target_date, p_status, p_note)
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
