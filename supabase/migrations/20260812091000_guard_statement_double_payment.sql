-- Denetim 2026-08-12 K4: acik ekstre + pay_card_debt + pay_card_statement
-- sirasiyla ayni borc bankadan IKI KEZ dusebiliyordu.
--
-- pay_card_debt ekstre kovasini oder ama arsivi kapatmaz; ardindan kullanici
-- "ekstreyi ode" derse pay_card_statement ayni tutari kaynak hesaptan ikinci
-- kez ceker (kart borcu minimum-gorunur tabana takilir ama nakit iki kez
-- cikmistir). DB katmaninda engel yoktu.
--
-- Dar guard: ekstre kovasi (cards.statement_debt_amount) zaten 0 ise bu arsiv
-- borcu baska bir akisla odenmis demektir -> odeme reddedilir. Kova > 0 iken
-- arsiv tutarindan kucuk olmasi (bilincli drift toleransi, 20260724130000'in
-- kaldirilma gerekcesi) odemeyi ENGELLEMEZ; yalniz tam-cift-odeme yakalanir.
-- Guard, B4 (p_skip_source_debit) yolunda da gecerlidir: bakiye dusmese bile
-- odenmis borca ikinci "odendi" kaydi uretmek yanlistir.
--
-- Fonksiyon govdesi 20260810140000 ile ayni; tek fark eklenen kova kontrolu.

create or replace function public.pay_card_statement(
  p_statement_id uuid,
  p_source_card_id uuid,
  p_skip_source_debit boolean default false
)
returns public.card_statement_archives
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_initial_card_id uuid;
  v_statement public.card_statement_archives%rowtype;
  v_paid_statement public.card_statement_archives%rowtype;
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_payment_amount numeric(14, 2);
  v_remaining_statement_debt numeric(14, 2);
  v_minimum_visible_debt numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select card_id
  into v_initial_card_id
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Ekstre bulunamadı.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_initial_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstresi ödenecek kredi kartı bulunamadı.';
  end if;

  select *
  into v_statement
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id
    and card_id = v_card.id
  for update;

  if not found then
    raise exception 'Ekstre bulunamadı veya kartı değişti; yeniden deneyin.';
  end if;

  if v_statement.status <> 'open' then
    raise exception 'Bu ekstre zaten kapalı.';
  end if;

  v_payment_amount := round(greatest(0, v_statement.statement_debt_amount), 2);
  if v_payment_amount <= 0 then
    raise exception 'Ekstre tutarı 0 olduğu için ödeme yapılamaz.';
  end if;

  -- K4 guard: kartin ekstre kovasi zaten sifirsa bu arsivin borcu baska bir
  -- akisla (ör. "kart borcu öde") odenmis demektir. Bankadan ikinci kez para
  -- dusurmek yerine acik bir hatayla durdur.
  if round(greatest(0, v_card.statement_debt_amount), 2) <= 0 then
    raise exception 'Bu ekstrenin borcu görünmüyor: kart borcu daha önce başka bir ödemeyle kapatılmış olabilir. Tekrar ödeme bankadan ikinci kez para düşürürdü. Ekstre kaydını Kartlar sayfasındaki mutabakat akışıyla kapat.';
  end if;

  if p_skip_source_debit then
    -- B4: Bakiye banka/SMS tarafından zaten düşülmüş; yalnız doğrula, düşme.
    select *
    into v_source
    from public.cards
    where id = p_source_card_id
      and user_id = v_user_id
      and card_type = 'banka_karti'
    for update;

    if not found then
      raise exception 'Kaynak banka hesabı bulunamadı.';
    end if;
  else
    -- Kaynak hesap hareketi ekstre arşivindeki banka tutarıyla yapılır. Kartın
    -- geçici aggregate drift'i ödemeyi engellemez.
    v_source := private.debit_bank_account(p_source_card_id, v_payment_amount);
  end if;

  perform set_config('app.card_statement_payment_user_id', v_user_id::text, true);
  perform set_config('app.card_statement_payment_id', v_statement.id::text, true);

  update public.card_statement_archives
  set status = 'paid',
      paid_at = now(),
      payment_source_card_id = v_source.id,
      updated_at = now()
  where id = v_statement.id
  returning * into v_paid_statement;

  perform set_config('app.card_statement_payment_id', '', true);
  perform set_config('app.card_statement_payment_user_id', '', true);

  select round(coalesce(sum(statement_debt_amount), 0), 2)
  into v_remaining_statement_debt
  from public.card_statement_archives
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'open';

  v_minimum_visible_debt := round(
    v_remaining_statement_debt
      + greatest(0, v_card.current_period_spending)
      + greatest(0, v_card.provision_amount),
    2
  );

  update public.cards
  set debt_amount = greatest(
        0,
        round(v_card.debt_amount - v_payment_amount, 2),
        v_minimum_visible_debt
      ),
      statement_debt_amount = v_remaining_statement_debt,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (
    user_id, type, title, amount, source_table, source_id, note
  )
  values (
    v_user_id,
    'payment',
    v_card.card_name || ' ekstresi ödendi',
    v_payment_amount,
    'card_statement_archives',
    v_statement.id,
    v_source.card_name || case
      when p_skip_source_debit
      then ' hesabındaki bakiye banka/SMS hareketiyle zaten düşülmüştü; tekrar düşülmedi. Taksit planı değiştirilmedi.'
      else ' hesabından ödendi. Taksit planı değiştirilmedi.'
    end
  );

  return v_paid_statement;
end;
$$;

revoke execute on function public.pay_card_statement(uuid, uuid, boolean) from public;
revoke execute on function public.pay_card_statement(uuid, uuid, boolean) from anon;
grant execute on function public.pay_card_statement(uuid, uuid, boolean) to authenticated;
