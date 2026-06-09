-- Tek bir kartın tüm kart verisini (harcamalar, taksitler, ekstre arşivleri ve
-- bunlara bağlı hareket geçmişi) siler ve kredi kartı toplamlarını sıfırlar.
-- "Temiz ekstre içe aktarma" akışı bunu çağırıp kartı baseline'a çeker; diğer
-- kartlara ve kart-dışı verilere (kredi, varlık, bütçe...) dokunmaz.

create or replace function public.reset_card_data(
  p_card_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  -- Önce bağlı hareket geçmişini sil (kaynak satırlar silinmeden referansları topla).
  delete from public.transaction_history
  where user_id = v_user_id
    and (
      (source_table = 'card_expenses'
        and source_id in (select id from public.card_expenses where card_id = p_card_id and user_id = v_user_id))
      or (source_table = 'card_installments'
        and source_id in (select id from public.card_installments where card_id = p_card_id and user_id = v_user_id))
      or (source_table = 'card_statement_archives'
        and source_id in (select id from public.card_statement_archives where card_id = p_card_id and user_id = v_user_id))
    );

  delete from public.card_installments
  where card_id = p_card_id and user_id = v_user_id;

  delete from public.card_statement_archives
  where card_id = p_card_id and user_id = v_user_id;

  delete from public.card_expenses
  where card_id = p_card_id and user_id = v_user_id;

  -- Kredi kartı borç kırılımını sıfırla; banka kartı bakiyesine dokunma.
  update public.cards
  set debt_amount = 0,
      statement_debt_amount = 0,
      current_period_spending = 0,
      provision_amount = 0,
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;
end;
$$;

revoke execute on function public.reset_card_data(uuid) from anon;
revoke execute on function public.reset_card_data(uuid) from public;
grant execute on function public.reset_card_data(uuid) to authenticated;
