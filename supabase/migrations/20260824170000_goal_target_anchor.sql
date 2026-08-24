-- Hedef TUTARININ çıpası: "1M TL" üç yıl sonra bugünkü 1M değil.
--
-- Takip kaynaklarıyla (aynı gün) hedefin BİRİKEN tarafı canlandı; hedef tarafı
-- hâlâ donuk bir sayıydı. Artık hedef bir çıpaya bağlanabilir:
--
--   gold / usd      → hedef bugünkü TL ile girilir, o günün kuruyla birime
--                     (gram / USD) çevrilip SAKLANIR; ekranda birim × canlı kur
--                     olarak yürür. Satın alma gücü korunur, varsayım yok.
--   expense_months  → "acil fonum 6 aylık giderim kadar olsun": hedef, gerçekleşen
--                     aylık nakit çıkışı ortalamasından türer ve harcaman
--                     büyüdükçe hedef de büyür.
--
-- TÜFE endeksi bilinçli olarak YOK: elle girilen bir enflasyon varsayımı sayıya
-- gömülmüş bir tahmin olurdu, gerçek TÜFE ise yeni bir dış veri kaynağı + bakım
-- demekti. Altın/dolar zaten canlı ve doğrulanabilir.
--
-- Çıpalı hedefte `target_amount` 0'a çekilir: türetilebilen değer saklanmaz
-- (aynı kural biriken tarafında ve karma hedef sayaçlarında da geçerli).
-- Türetme TS ikizinde: utils/goalTargetAnchor.ts + resolveSavingsGoalRows.

alter table public.savings_goals
  add column target_anchor text not null default 'manual'
    check (target_anchor in ('manual', 'gold', 'usd', 'expense_months')),
  -- gold/usd: hedefin çıpa birimindeki büyüklüğü (gram ya da USD).
  add column target_anchor_units numeric null,
  -- expense_months: kaç aylık gider.
  add column target_anchor_months int null;

alter table public.savings_goals
  add constraint savings_goals_target_anchor_fields check (
    (target_anchor = 'manual' and target_anchor_units is null and target_anchor_months is null)
    or (target_anchor in ('gold', 'usd') and target_anchor_units is not null and target_anchor_units > 0 and target_anchor_months is null)
    or (target_anchor = 'expense_months' and target_anchor_months is not null and target_anchor_months > 0 and target_anchor_units is null)
  );

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
  p_components jsonb default '[]'::jsonb,
  p_sources jsonb default '[]'::jsonb,
  p_target_anchor text default 'manual',
  p_target_anchor_units numeric default null,
  p_target_anchor_months int default null
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
  v_src jsonb;
  v_index int;
  v_comp_id uuid;
  v_component_ids uuid[] := '{}'::uuid[];
  v_linked_indexes int[];
  v_goal_linked boolean;
  v_comp_current numeric;
  v_src_component_index int;
  v_src_component_id uuid;
  v_anchor text := coalesce(p_target_anchor, 'manual');
  v_anchor_units numeric := p_target_anchor_units;
  v_anchor_months int := p_target_anchor_months;
  v_target numeric := p_target_amount;
  v_current numeric := p_current_amount;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  -- Çıpa yalnız basit TL hedefte anlamlı; karma/altın hedefte sessizce
  -- yok sayılmaz, açıkça manual'e düşer.
  if p_is_composite or p_value_type <> 'TRY' then
    v_anchor := 'manual';
  end if;

  if v_anchor = 'manual' then
    v_anchor_units := null;
    v_anchor_months := null;
  elsif v_anchor in ('gold', 'usd') then
    v_anchor_months := null;
    if v_anchor_units is null or v_anchor_units <= 0 then
      raise exception 'Çıpa birimi 0''dan büyük olmalı.';
    end if;
    -- Hedef tutarı birim × canlı kurdan türetilir; saklanan kopya bayat kalırdı.
    v_target := 0;
  else
    v_anchor_units := null;
    if v_anchor_months is null or v_anchor_months <= 0 then
      raise exception 'Ay sayısı 0''dan büyük olmalı.';
    end if;
    v_target := 0;
  end if;

  select coalesce(array_agg((s->>'component_index')::int), '{}'::int[])
  into v_linked_indexes
  from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) as s
  where nullif(s->>'component_index', '') is not null;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) as s
    where nullif(s->>'component_index', '') is null
  )
  into v_goal_linked;

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
  elsif v_goal_linked then
    v_current := 0;
  end if;

  if p_goal_id is not null then
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
        target_anchor = v_anchor,
        target_anchor_units = v_anchor_units,
        target_anchor_months = v_anchor_months,
        updated_at = now()
    where id = p_goal_id
      and user_id = v_user_id;

    if not found then
      raise exception 'Hedef bulunamadı.';
    end if;

    v_goal_id := p_goal_id;
  else
    insert into public.savings_goals (
      user_id, name, value_type, target_amount, current_amount, estimated_value_try,
      auto_valued, target_date, status, note, target_anchor, target_anchor_units, target_anchor_months
    )
    values (
      v_user_id, p_name, p_value_type, v_target, v_current, p_estimated_value_try,
      p_auto_valued, p_target_date, p_status, p_note, v_anchor, v_anchor_units, v_anchor_months
    )
    returning id into v_goal_id;
  end if;

  if p_is_composite then
    for v_comp, v_index in
      select value, ordinality from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) with ordinality
    loop
      v_comp_current := case
        when (v_index - 1) = any(v_linked_indexes) then 0
        else coalesce((v_comp->>'current_amount')::numeric, 0)
      end;

      v_comp_id := nullif(v_comp->>'id', '')::uuid;

      if v_comp_id is not null then
        update public.savings_goal_components
        set label = v_comp->>'label',
            value_type = v_comp->>'value_type',
            target_amount = coalesce((v_comp->>'target_amount')::numeric, 0),
            current_amount = v_comp_current,
            sort_order = coalesce((v_comp->>'sort_order')::int, v_index - 1),
            updated_at = now()
        where id = v_comp_id
          and goal_id = v_goal_id
          and user_id = v_user_id;

        if not found then
          v_comp_id := null;
        end if;
      end if;

      if v_comp_id is null then
        insert into public.savings_goal_components (user_id, goal_id, label, value_type, target_amount, current_amount, sort_order)
        values (
          v_user_id,
          v_goal_id,
          v_comp->>'label',
          v_comp->>'value_type',
          coalesce((v_comp->>'target_amount')::numeric, 0),
          v_comp_current,
          coalesce((v_comp->>'sort_order')::int, v_index - 1)
        )
        returning id into v_comp_id;
      end if;

      v_component_ids := v_component_ids || v_comp_id;
    end loop;

    delete from public.savings_goal_components
    where goal_id = v_goal_id
      and user_id = v_user_id
      and not (id = any(v_component_ids));
  elsif p_goal_id is not null then
    delete from public.savings_goal_components
    where goal_id = v_goal_id
      and user_id = v_user_id;
  end if;

  delete from public.savings_goal_sources
  where goal_id = v_goal_id
    and user_id = v_user_id;

  for v_src in select * from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    v_src_component_index := nullif(v_src->>'component_index', '')::int;
    v_src_component_id := null;

    if v_src_component_index is not null then
      if not p_is_composite
        or v_src_component_index < 0
        or v_src_component_index >= coalesce(array_length(v_component_ids, 1), 0) then
        continue;
      end if;
      v_src_component_id := v_component_ids[v_src_component_index + 1];
    end if;

    insert into public.savings_goal_sources (
      user_id, goal_id, component_id, kind, asset_id, asset_category, card_id, bucket_id, sort_order
    )
    values (
      v_user_id,
      v_goal_id,
      v_src_component_id,
      v_src->>'kind',
      nullif(v_src->>'asset_id', '')::uuid,
      nullif(v_src->>'asset_category', ''),
      nullif(v_src->>'card_id', '')::uuid,
      nullif(v_src->>'bucket_id', '')::uuid,
      coalesce((v_src->>'sort_order')::int, 0)
    )
    on conflict do nothing;
  end loop;

  return v_goal_id;
end;
$$;

-- Eski 13 argümanlı sürüm kalırsa PostgREST çağrıyı belirsiz bulur.
drop function if exists public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb, jsonb);

revoke execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb, jsonb, text, numeric, int) from public;
revoke execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb, jsonb, text, numeric, int) from anon;
grant execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb, jsonb, text, numeric, int) to authenticated;
