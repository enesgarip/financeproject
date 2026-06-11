-- Atomic manual account movement (roadmap "güven" Faz 4).
--
-- Manual cash in/out (services/accountMovements.ts) used to update
-- `cards.current_balance` directly and then write `transaction_history` in a
-- SEPARATE client call — non-atomic: the balance could change while the history
-- (activity feed) row silently failed. Every other money mutation is an RPC that
-- writes its history row in the same transaction; this brings manual in/out in
-- line. The balance update also fires the Faz 3 account_ledger trigger inside the
-- same transaction, so balance + ledger event + history row all commit together.

create or replace function public.record_manual_account_movement(
  p_card_id uuid,
  p_amount numeric,
  p_direction text,
  p_note text default null
)
returns public.cards
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_new_balance numeric(14, 2);
  v_updated public.cards%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if v_amount <= 0 then
    raise exception 'Tutar 0 dan buyuk olmali.';
  end if;

  if p_direction not in ('in', 'out') then
    raise exception 'Gecersiz hareket yonu.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Hesap bulunamadi.';
  end if;

  if v_card.card_type <> 'banka_karti' then
    raise exception 'Sadece banka hesabina manuel hareket girilebilir.';
  end if;

  if p_direction = 'out' then
    if v_card.current_balance < v_amount then
      raise exception 'Giden tutar mevcut bakiyeden buyuk olamaz.';
    end if;
    v_new_balance := v_card.current_balance - v_amount;
  else
    v_new_balance := v_card.current_balance + v_amount;
  end if;

  update public.cards
  set current_balance = v_new_balance,
      updated_at = now()
  where id = p_card_id
  returning * into v_updated;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'transfer',
    v_card.card_name || (case when p_direction = 'in' then ' para girişi' else ' para çıkışı' end),
    v_amount,
    'cards',
    v_card.id,
    coalesce(nullif(btrim(p_note), ''), case when p_direction = 'in' then 'Banka kartına para geldi.' else 'Banka kartından para çıktı.' end)
  );

  return v_updated;
end;
$$;

grant execute on function public.record_manual_account_movement(uuid, numeric, text, text) to authenticated;
