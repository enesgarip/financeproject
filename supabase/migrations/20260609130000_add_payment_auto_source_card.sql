-- Banka talimatı / otomatik ödeme planlı ödemeleri için kredi kartı bağlama.
-- Vade geldiğinde bu ödemeler manuel "Öde" gerektirmeden seçili kredi kartına
-- harcama (borç) olarak otomatik işlenir.

alter table public.payments
  add column if not exists auto_source_card_id uuid references public.cards(id) on delete set null;

create index if not exists payments_due_card_auto_payments_idx
  on public.payments (user_id, due_date)
  where status = 'bekliyor'
    and payment_method = 'bank_auto'
    and auto_source_card_id is not null
    and amount > 0;

-- Vadesi gelmiş banka talimatlarını seçili kredi kartına borç olarak postalar.
-- Mevcut pay_payment mantığını yeniden kullanır (kredi kartına harcama açma +
-- aylık tekrarı ilerletme). Tutarı bilinmeyen (<=0) tahmini kayıtlar atlanır;
-- onlar manuel ödenmeye devam eder.
create or replace function public.post_due_card_auto_payments()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_payment public.payments%rowtype;
  v_count integer := 0;
  v_guard integer := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  loop
    select *
    into v_payment
    from public.payments
    where user_id = v_user_id
      and status = 'bekliyor'
      and payment_method = 'bank_auto'
      and auto_source_card_id is not null
      and amount > 0
      and due_date <= current_date
      and exists (
        select 1
        from public.cards
        where cards.id = payments.auto_source_card_id
          and cards.user_id = v_user_id
          and cards.card_type = 'kredi_karti'
      )
    order by due_date asc
    limit 1;

    exit when not found;

    perform public.pay_payment(v_payment.id, v_payment.auto_source_card_id, v_payment.amount);
    v_count := v_count + 1;

    -- Çok aylık gecikmelerde sonsuz döngüye karşı güvenlik sınırı.
    v_guard := v_guard + 1;
    exit when v_guard > 500;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.post_due_card_auto_payments() from anon;
revoke execute on function public.post_due_card_auto_payments() from public;
grant execute on function public.post_due_card_auto_payments() to authenticated;
