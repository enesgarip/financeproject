-- Denetim 2026-08-12 §2 "klasik bankacılığa aykırılıklar" kapanışı (K2 dilimi).
--
-- 1) Kredi taksitleri SIRAYLA ödenir: bankada 12. taksiti 7.'den önce ödemek
--    mümkün değildir; RPC bunu zorlamıyordu (UI sıradakini öne çıkarsa da
--    listeden herhangi biri ödenebiliyordu). pay_loan_installment, aynı
--    kredinin daha küçük numaralı BEKLEYEN taksiti varken ödemeyi reddeder.
--    Gövde 20260615120000'deki tanımın birebir kopyası + tek guard.
--
-- 2) run_scheduled_card_maintenance için service_role'e execute verilir:
--    pg_cron zamanlaması 20260604140000'de best-effort kuruluydu (eklenti
--    yoksa sessizce atlanır) ve üretimde koşup koşmadığı gözlemlenemiyordu.
--    push-notify günlük koşusu (07:00) artık adayları toplamadan önce bu
--    RPC'yi de çağırır — gözlemlenebilir ikinci kemer (RPC'ler idempotent,
--    olası çifte koşu güvenli). Public'e kapalı kalır.

create or replace function public.pay_loan_installment(
  p_installment_id uuid,
  p_source_card_id uuid
)
returns public.loan_installments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_installment public.loan_installments%rowtype;
  v_paid_installment public.loan_installments%rowtype;
  v_loan public.loans%rowtype;
  v_source public.cards%rowtype;
  v_remaining_amount numeric(14, 2);
  v_remaining_installments integer;
  v_paid_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select *
  into v_installment
  from public.loan_installments
  where id = p_installment_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Taksit bulunamadi.';
  end if;

  if v_installment.status = 'ödendi' then
    raise exception 'Bu taksit zaten odendi.';
  end if;

  if v_installment.amount <= 0 then
    raise exception 'Taksit tutari 0 dan buyuk olmali.';
  end if;

  -- Denetim §2: taksitler sırayla tahsil edilir. Daha küçük numaralı bekleyen
  -- taksit varken sonrakini ödemek banka gerçeğiyle çelişir (geçmişi nakit
  -- hareketsiz kapatmak isteyen kullanıcı için ayrı "Geçmişi ödendi say"
  -- akışı zaten var — o yol bu RPC'den geçmez).
  if exists (
    select 1
    from public.loan_installments
    where loan_id = v_installment.loan_id
      and user_id = v_user_id
      and status = 'bekliyor'
      and installment_no < v_installment.installment_no
  ) then
    raise exception 'Once siradaki taksit odenmeli: % numarali taksitten once bekleyen taksit var.', v_installment.installment_no;
  end if;

  select *
  into v_loan
  from public.loans
  where id = v_installment.loan_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kredi bulunamadi.';
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_installment.amount);

  update public.loan_installments
  set status = 'ödendi',
      paid_at = v_paid_at,
      updated_at = v_paid_at
  where id = v_installment.id
  returning * into v_paid_installment;

  select coalesce(sum(amount), 0), count(*)::integer
  into v_remaining_amount, v_remaining_installments
  from public.loan_installments
  where loan_id = v_loan.id
    and status <> 'ödendi';

  update public.loans
  set remaining_amount = v_remaining_amount,
      remaining_installments = v_remaining_installments,
      status = case when v_remaining_installments = 0 then 'closed' else 'active' end,
      updated_at = now()
  where id = v_loan.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'loan',
    v_loan.loan_name || ' ' || v_installment.installment_no || '. taksit odemesi',
    v_installment.amount,
    'loan_installments',
    v_installment.id,
    v_source.card_name || ' hesabindan odendi. Vade: ' || to_char(v_installment.due_date, 'YYYY-MM-DD')
  );

  return v_paid_installment;
end;
$$;

grant execute on function public.pay_loan_installment(uuid, uuid) to authenticated;

-- Kesim/provizyon bakımı artık sunucudan da tetiklenebilir (push-notify cron'u).
grant execute on function public.run_scheduled_card_maintenance(integer) to service_role;
