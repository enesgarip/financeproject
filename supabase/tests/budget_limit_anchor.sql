-- Bütçe limit çıpası: kombinasyon kısıtı ve varsayılan davranış.
--
-- Risk: çıpa kolonu değersiz (ya da manual satır değerli) kalırsa çözümleme
-- "hangisi doğru?" belirsizliğine düşer; kısıt bunu DB seviyesinde kapatmalı.
begin;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_anchor text;
  v_amount numeric;
begin
  -- 1) Varsayılan: çıpasız satır manual + NULL değerle doğar (eski davranış).
  insert into public.budgets (user_id, month, category, limit_amount)
  values (v_user, date_trunc('month', current_date)::date, 'Çıpa Testi', 6000);

  select limit_anchor, limit_amount into v_anchor, v_amount
  from public.budgets where category = 'Çıpa Testi';
  if v_anchor <> 'manual' or v_amount <> 6000 then
    raise exception 'BAŞARISIZ: varsayılan manual değil (% / %).', v_anchor, v_amount;
  end if;

  -- 2) Kurallı çıpa pozitif değerle kaydedilir; limit 0'a çekilir.
  insert into public.budgets (user_id, month, category, limit_amount, limit_anchor, limit_anchor_value)
  values (v_user, date_trunc('month', current_date)::date, 'Çıpa Testi 2', 0, 'avg_spend', 1.5);

  -- 3) Kurallı çıpa DEĞERSİZ kaydedilemez.
  begin
    insert into public.budgets (user_id, month, category, limit_amount, limit_anchor)
    values (v_user, date_trunc('month', current_date)::date, 'Çıpa Testi 3', 0, 'salary_pct');
    raise exception 'BAŞARISIZ: değersiz salary_pct kabul edildi.';
  exception
    when check_violation then null;
  end;

  -- 4) Manual satıra değer yazılamaz.
  begin
    insert into public.budgets (user_id, month, category, limit_amount, limit_anchor, limit_anchor_value)
    values (v_user, date_trunc('month', current_date)::date, 'Çıpa Testi 4', 5000, 'manual', 2);
    raise exception 'BAŞARISIZ: manual satıra çıpa değeri kabul edildi.';
  exception
    when check_violation then null;
  end;

  -- 5) Negatif/sıfır çarpan reddedilir.
  begin
    insert into public.budgets (user_id, month, category, limit_amount, limit_anchor, limit_anchor_value)
    values (v_user, date_trunc('month', current_date)::date, 'Çıpa Testi 5', 0, 'avg_spend', 0);
    raise exception 'BAŞARISIZ: sıfır çarpan kabul edildi.';
  exception
    when check_violation then null;
  end;

  raise notice 'budget_limit_anchor: tüm kontroller geçti';
end $$;

rollback;
