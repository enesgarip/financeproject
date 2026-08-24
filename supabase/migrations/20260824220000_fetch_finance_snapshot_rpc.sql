-- Açılış snapshot'ı tek istekte: fetch_finance_snapshot
--
-- Neden: fetchFinanceSnapshot açılışta 17 ayrı PostgREST isteği atıyordu
-- (Promise.all). Mobilde her istek kendi HTTP round-trip'ini ödüyordu; bu RPC
-- aynı veriyi tek JSON yükünde döndürür. (2026-08-24 performans turunun
-- bilinçli ertelenen en yüksek etkili işi.)
--
-- Sözleşme (client ikizi: src/data/repositories/financeSnapshotRepo.ts):
--  - security invoker: RLS aynen uygulanır. Sorgularda user_id filtresi YOK —
--    PostgREST yolundaki gibi own-row policy'ler süzer; filtre eklemek
--    semantiği değiştirmez ama iki yolun birebir aynı olduğu iddiasını bozar.
--  - Pencere/limit parametreleri CLIENT'tan gelir: SNAPSHOT_HISTORY_MONTHS ve
--    STATEMENT_ARCHIVE_LIMIT'in tek kaynağı client kalır, sabit değişince
--    migration gerekmez. Filtre/sıralama legacy sorgularla birebir aynıdır.
--  - optionalRows ikizi: migration bekleyen ortamda eksik OPSİYONEL tablo hata
--    değildir; to_regclass kapısı eksikliği missing_tables listesine çevirir.
--    Zorunlu tablolar eksikse hata görünür kalır (legacy requiredRows gibi).
--    RPC'nin KENDİSİ yoksa client eski 17-sorgu yoluna düşer (fallback).

create or replace function public.fetch_finance_snapshot(
  p_window_start timestamptz,
  p_window_start_date date,
  p_statement_limit integer default 120
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_payload jsonb;
  v_rows jsonb;
  v_missing text[] := array[]::text[];
  v_tbl text;
  v_query text;
begin
  if (select auth.uid()) is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  -- Zorunlu tablolar (legacy requiredRows): statik SQL bilinçli — tablo yoksa
  -- "relation does not exist" hatası aynen görünür kalmalı.
  select jsonb_build_object(
    'assets', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.assets t),
    'cards', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.cards t),
    'loans', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.loans t),
    'loan_installments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.loan_installments t),
    'debts', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.debts t),
    'payments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.payments t),
    'salary_history', (select coalesce(jsonb_agg(to_jsonb(t) order by t.effective_date desc), '[]'::jsonb) from public.salary_history t),
    'transaction_history', (select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at desc), '[]'::jsonb) from public.transaction_history t where t.occurred_at >= p_window_start),
    'card_expenses', (select coalesce(jsonb_agg(to_jsonb(t) order by t.spent_at desc), '[]'::jsonb) from public.card_expenses t where t.spent_at >= p_window_start_date)
  )
  into v_payload;

  -- Opsiyonel tablolar (legacy optionalRows): dinamik SQL bilinçli — statik
  -- referans tablo yokken TÜM fonksiyonu kırardı. Kullanılmayan USING
  -- parametresi serbesttir; her sorgu yalnız ihtiyacı olan $n'i okur.
  for v_tbl, v_query in
    select * from (values
      ('budgets', $q$select coalesce(jsonb_agg(to_jsonb(t) order by t.month desc), '[]'::jsonb) from public.budgets t where t.month >= $1$q$),
      ('card_installments', $q$select coalesce(jsonb_agg(to_jsonb(t) order by t.due_month asc), '[]'::jsonb) from public.card_installments t$q$),
      ('card_statement_archives', $q$select coalesce(jsonb_agg(to_jsonb(t) order by t.statement_date desc), '[]'::jsonb) from (select * from public.card_statement_archives order by statement_date desc limit coalesce($2, 120)) t$q$),
      ('card_statement_payments', $q$select coalesce(jsonb_agg(to_jsonb(t) order by t.paid_at desc), '[]'::jsonb) from public.card_statement_payments t$q$),
      ('savings_goals', $q$select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) from public.savings_goals t$q$),
      ('savings_goal_components', $q$select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.savings_goal_components t$q$),
      ('savings_goal_sources', $q$select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order asc), '[]'::jsonb) from public.savings_goal_sources t$q$),
      ('account_reconciliations', $q$select coalesce(jsonb_agg(to_jsonb(t) order by t.reconciled_at desc), '[]'::jsonb) from public.account_reconciliations t$q$)
    ) as cfg(tbl, query)
  loop
    if to_regclass('public.' || v_tbl) is null then
      v_missing := v_missing || v_tbl;
      v_rows := '[]'::jsonb;
    else
      execute v_query into v_rows using p_window_start_date, p_statement_limit;
    end if;
    v_payload := v_payload || jsonb_build_object(v_tbl, v_rows);
  end loop;

  return v_payload || jsonb_build_object('missing_tables', to_jsonb(v_missing));
end;
$fn$;

revoke execute on function public.fetch_finance_snapshot(timestamptz, date, integer) from public;
revoke execute on function public.fetch_finance_snapshot(timestamptz, date, integer) from anon;
grant execute on function public.fetch_finance_snapshot(timestamptz, date, integer) to authenticated;
