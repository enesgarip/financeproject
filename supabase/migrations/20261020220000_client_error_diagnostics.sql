-- Faz Teşhis: eski kayıtları koruyan, sadece teknik bağlam taşıyan ek alan.
alter table public.client_errors add column if not exists diagnostics jsonb;
alter table public.client_errors drop constraint if exists client_errors_source_check;
alter table public.client_errors add constraint client_errors_source_check
  check (source in ('boundary', 'error', 'unhandledrejection', 'resource', 'security', 'network'));
alter table public.client_errors add constraint client_errors_diagnostics_size
  check (diagnostics is null or (jsonb_typeof(diagnostics) = 'object' and octet_length(diagnostics::text) <= 32768));
-- INSERT ON CONFLICT DO NOTHING aynı rapor UUID'sinin retry'ını tekilleştirir.
-- Mevcut own-row RLS ve select/insert/delete grant'ları korunur; UPDATE yoktur.
revoke update on table public.client_errors from anon, authenticated;
