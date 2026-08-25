-- sync_loan_summary satır-başına → STATEMENT-level (perf turu, bilinçli
-- ertelenmişti: "önce invariant testi" — supabase/tests/loan_summary_invariant.sql
-- bu migration'la birlikte geliyor ve davranışı sabitliyor).
--
-- Sorun: FOR EACH ROW trigger, toplu yazımda (örn. 36 taksitlik plan kurulumu,
-- ekstre-import benzeri çok satırlı update) her satır için kredinin TÜM
-- taksitlerini yeniden topluyordu — O(n²). Statement-level: dokunulan kredi
-- kimlikleri transition tablolarından toplanır, özet kredi başına BİR kez
-- yeniden kurulur. Davranış birebir: özet = ödenmemiş taksit projeksiyonu,
-- 0 taksit = closed (TS ikizi projectLoanSummary ile hizalı).
--
-- Postgres kısıtı: REFERENCING tanımı olay başına ayrı trigger ister → üç
-- trigger tek fonksiyonu çağırır; fonksiyon TG_OP'a göre doğru transition
-- tablosunu okur (bildirilmemiş tabloya dokunmak hata olurdu).

create or replace function public.sync_loan_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct loan_id) into v_loan_ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct loan_id) into v_loan_ids from old_rows;
  else
    select array_agg(distinct loan_id) into v_loan_ids
    from (select loan_id from new_rows union select loan_id from old_rows) touched;
  end if;

  if v_loan_ids is null then
    return null;
  end if;

  update public.loans l
  set remaining_amount = s.amt,
      remaining_installments = s.cnt,
      status = case when s.cnt = 0 then 'closed' else 'active' end,
      updated_at = now()
  from unnest(v_loan_ids) as ids(loan_id)
  cross join lateral (
    select coalesce(sum(li.amount), 0) as amt, count(*)::integer as cnt
    from public.loan_installments li
    where li.loan_id = ids.loan_id and li.status <> 'ödendi'
  ) s
  where l.id = ids.loan_id;

  return null;
end;
$$;

drop trigger if exists loan_installments_sync_summary on public.loan_installments;

create trigger loan_installments_sync_summary_ins
  after insert on public.loan_installments
  referencing new table as new_rows
  for each statement execute function public.sync_loan_summary();

create trigger loan_installments_sync_summary_upd
  after update on public.loan_installments
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.sync_loan_summary();

create trigger loan_installments_sync_summary_del
  after delete on public.loan_installments
  referencing old table as old_rows
  for each statement execute function public.sync_loan_summary();
