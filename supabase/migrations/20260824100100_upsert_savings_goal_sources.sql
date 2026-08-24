-- upsert_savings_goal: takip kaynakları + bileşen kimliğinin korunması.
--
-- İki değişiklik:
--
-- 1) Bileşenler artık SİL-YAZ değil, id ile upsert ediliyor. Eski akışta her
--    kayıtta bileşenler silinip yeniden ekleniyordu; bileşene bağlı kaynaklar
--    (savings_goal_sources.component_id) cascade ile birlikte uçardı — yani
--    kullanıcı hedefi düzenlediği anda bağladığı varlık kaybolurdu.
--
-- 2) p_sources ile kaynak listesi tek transaction'da yazılıyor. Kaynağa bağlı
--    satırın `current_amount` kolonu 0'a çekilir: biriken tutar okuma anında
--    kaynaklardan türetilir (canlı BIST fiyatı/kur yalnız client'ta), saklanan
--    kopya bayat kalır ve "hangisi doğru?" sorusunu doğururdu.
--    Karma hedefte sayaçlar bileşenlerden türetilmeye devam eder; bağlı
--    bileşenin "hedefine ulaştı mı?" bilgisini DB bilemediği için ekranlardaki
--    tek doğru kaynak TS ikizi resolveSavingsGoalRows'tur (bkz. goalSources.ts).

drop function if exists public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb);

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
  p_sources jsonb default '[]'::jsonb
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
  v_target numeric := p_target_amount;
  v_current numeric := p_current_amount;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  -- Hangi satırların biriken tutarı kaynaktan türetilecek? (component_index
  -- NULL olan kaynak hedefin kendisine bağlıdır.)
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
        updated_at = now()
    where id = p_goal_id
      and user_id = v_user_id;

    if not found then
      raise exception 'Hedef bulunamadı.';
    end if;

    v_goal_id := p_goal_id;
  else
    insert into public.savings_goals (user_id, name, value_type, target_amount, current_amount, estimated_value_try, auto_valued, target_date, status, note)
    values (v_user_id, p_name, p_value_type, v_target, v_current, p_estimated_value_try, p_auto_valued, p_target_date, p_status, p_note)
    returning id into v_goal_id;
  end if;

  -- Bileşen yönetimi: id taşıyan bileşen GÜNCELLENİR (bağlı kaynağı yaşasın),
  -- gelmeyen bileşen silinir.
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

        -- Başka hedefin/kullanıcının id'si gönderildiyse yeni satır olarak ekle.
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
    -- Composite'den basit tipe geçiş: eski bileşenleri temizle.
    delete from public.savings_goal_components
    where goal_id = v_goal_id
      and user_id = v_user_id;
  end if;

  -- Kaynaklar: türetilmiş bir şey saklamadıkları için sil-yaz güvenli.
  delete from public.savings_goal_sources
  where goal_id = v_goal_id
    and user_id = v_user_id;

  for v_src in select * from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    v_src_component_index := nullif(v_src->>'component_index', '')::int;
    v_src_component_id := null;

    if v_src_component_index is not null then
      -- Bileşen bağı yalnız karma hedefte ve gerçekten yazılmış bir bileşen
      -- için anlamlı; aksi hâlde satır hedef seviyesine DÜŞMEZ, atlanır.
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

revoke execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb, jsonb) from public;
revoke execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb, jsonb) from anon;
grant execute on function public.upsert_savings_goal(uuid, text, text, numeric, numeric, numeric, boolean, date, text, text, boolean, jsonb, jsonb) to authenticated;
