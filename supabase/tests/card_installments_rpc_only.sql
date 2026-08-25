-- T1: card_installments RPC-only yazım + parent-user invariantı.
--
-- Riskler: (1) revoke eksik kalırsa doğrudan UPDATE/DELETE açık kalır;
-- (2) bileşik FK yanlış kurulursa ya meşru insert kırılır (restore yolu)
-- ya da başka kullanıcının harcamasına taksit bağlanabilir kalır;
-- (3) DEFINER geçişi cross-user erişimi gövde filtreleri yerine RLS'e
-- bırakmışsa sızıntı olur — update_card_expense reddi bunu sınar.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_expense public.card_expenses%rowtype;
  v_installment uuid;
begin
  insert into public.cards (user_id, bank_name, card_name, card_type, debt_amount, statement_debt_amount, current_period_spending, provision_amount, statement_day, due_day, credit_limit)
  values (v_user, 'T1 Bankası', 'RPC-Only Test', 'kredi_karti', 0, 0, 0, 0, 15, 28, 50000)
  returning id into v_card;

  -- Taksitli harcama RPC ile kurulur (yazım yolu hâlâ çalışıyor kanıtı).
  v_expense := public.add_card_expense(v_card, 3000, 'T1 TAKSIT', private.today_ist(), 3, 'Diğer', 'posted');

  select id into v_installment
  from public.card_installments
  where card_expense_id = v_expense.id and status = 'scheduled'
  order by installment_no limit 1;
  if v_installment is null then
    raise exception 'BAŞARISIZ: RPC taksit planı kurmadı.';
  end if;

  -- 1) Doğrudan UPDATE artık kapalı.
  begin
    update public.card_installments set amount = 1 where id = v_installment;
    raise exception 'BAŞARISIZ: doğrudan UPDATE kabul edildi.';
  exception
    when insufficient_privilege then null;
  end;

  -- 2) Doğrudan DELETE artık kapalı.
  begin
    delete from public.card_installments where id = v_installment;
    raise exception 'BAŞARISIZ: doğrudan DELETE kabul edildi.';
  exception
    when insufficient_privilege then null;
  end;

  -- 3) INSERT açık (JSON restore replay yolu) ama parent-user invariantı
  --    şemada: kendi harcamasına ekleme geçer...
  insert into public.card_installments (user_id, card_id, card_expense_id, installment_no, installment_count, due_month, amount, status, description)
  values (v_user, v_card, v_expense.id, 9, 9, private.today_ist() + 300, 1, 'scheduled', 'restore-replay');

  -- 4) RPC yolu (DEFINER) çalışmaya devam ediyor: düzenleme taksit planını
  --    yeniden kurar (içerideki DELETE artık gövde filtresiyle, RLS'siz).
  perform public.update_card_expense(v_expense.id, 4000, 'T1 TAKSIT GUNCEL', null, 4, null, null);
  -- 4 taksit → 4 satır; elle eklenen replay satırı da RPC'nin (artık gövde
  -- filtreli, RLS'siz) DELETE'iyle plan yeniden kurulurken gitmiş olmalı.
  if (select count(*) from public.card_installments where card_expense_id = v_expense.id) <> 4 then
    raise exception 'BAŞARISIZ: RPC düzenlemesi taksit planını yeniden kuramadı (%).',
      (select count(*) from public.card_installments where card_expense_id = v_expense.id);
  end if;
end $$;

-- 5) Başka kullanıcı: DEFINER'a rağmen erişim gövde filtresiyle reddedilir;
--    yabancı harcamaya taksit bağlamak bileşik FK'ya takılır.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_target uuid;
begin
  select id into v_target from public.card_expenses where description = 'T1 TAKSIT GUNCEL';

  begin
    perform public.update_card_expense(v_target, 1, 'ELE GECIRME', null, 1, null, null);
    raise exception 'BAŞARISIZ: DEFINER RPC başka kullanıcının harcamasını düzenledi.';
  exception
    when raise_exception then
      if sqlerrm like 'BAŞARISIZ%' then raise; end if;
  end;

  begin
    insert into public.card_installments (user_id, card_id, card_expense_id, installment_no, installment_count, due_month, amount, status, description)
    values ('22222222-2222-2222-2222-222222222222',
            (select card_id from public.card_expenses where id = v_target),
            v_target, 1, 1, current_date, 1, 'scheduled', 'sizinti');
    raise exception 'BAŞARISIZ: yabancı harcamaya taksit bağlandı (bileşik FK delik).';
  exception
    when foreign_key_violation or insufficient_privilege then null;
  end;

  raise notice 'card_installments_rpc_only: tüm kontroller geçti';
end $$;

rollback;
