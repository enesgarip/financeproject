-- Kısmi provizyon kesinleşmesi bağlam etiketini koruyor mu?
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_context uuid := 'c0000000-0000-4000-8000-000000000001';
  v_card uuid := 'c0000000-0000-4000-8000-000000000002';
  v_partial uuid := 'c0000000-0000-4000-8000-000000000003';
  v_full uuid := 'c0000000-0000-4000-8000-000000000004';
  v_posted public.card_expenses%rowtype;
  v_remaining public.card_expenses%rowtype;
begin
  insert into public.expense_contexts (id, user_id, kind, name)
  values (v_context, v_user, 'project', 'Provizyon bağlamı');

  insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, provision_amount)
  values (v_card, v_user, 'Test Bank', 'Test Kart', 'kredi_karti', 50000, 1000);

  -- 1) Kısmi kesinleşme: 1000 TL provizyonun 400'ü düşüyor.
  insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, status, context_id)
  values (v_partial, v_user, v_card, current_date, 1000, 'Kısmi provizyon', 'Diğer', 'provision', v_context);

  select * into v_posted from public.post_card_provision(v_partial, 400);

  if v_posted.id = v_partial then
    raise exception 'BEKLENEN: kısmi kesinleşme yeni satır açmalı.';
  end if;
  if v_posted.context_id is distinct from v_context then
    raise exception 'BAŞARISIZ: kesinleşen kısım bağlamı kaybetti (context_id=%).', v_posted.context_id;
  end if;
  if v_posted.amount <> 400 then
    raise exception 'BAŞARISIZ: kesinleşen tutar 400 değil (%).', v_posted.amount;
  end if;

  select * into v_remaining from public.card_expenses where id = v_partial;
  if v_remaining.amount <> 600 or v_remaining.status <> 'provision' then
    raise exception 'BAŞARISIZ: kalan provizyon 600/provision değil (%/%).', v_remaining.amount, v_remaining.status;
  end if;
  if v_remaining.context_id is distinct from v_context then
    raise exception 'BAŞARISIZ: kalan provizyon bağlamı kaybetti.';
  end if;

  -- 2) Tam kesinleşme yolu (aynı satır güncellenir) hâlâ bağlamı koruyor mu?
  insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, status, context_id)
  values (v_full, v_user, v_card, current_date, 250, 'Tam provizyon', 'Diğer', 'provision', v_context);

  select * into v_posted from public.post_card_provision(v_full);

  if v_posted.id <> v_full or v_posted.status <> 'posted' then
    raise exception 'BAŞARISIZ: tam kesinleşme aynı satırı posted yapmalı.';
  end if;
  if v_posted.context_id is distinct from v_context then
    raise exception 'BAŞARISIZ: tam kesinleşme bağlamı kaybetti.';
  end if;

  raise notice 'GEÇTI: kısmi + tam provizyon kesinleşmesi bağlamı koruyor.';
end;
$$;

rollback;
