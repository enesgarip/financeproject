-- Tamamlama yalnız raporlama durumudur; giderler, kart etiketleri ve ledger korunur.
alter table public.expense_contexts
  add column completed_at timestamptz default null;

comment on column public.expense_contexts.completed_at is
  'Tamamlanan grup yeni gider seçimlerinden gizlenir; geçmişi korunur. NULL = aktif.';
