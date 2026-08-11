-- Faz D1: Mutabakat kaydı düzeltilen farkı siliyordu.
--
-- "Farkı düzelt" akışı (LiveReconciliationPanel + CurrentMovementImportModal)
-- ledger düzeltmesini uyguladıktan sonra mutabakat satırına app_amount = gerçek,
-- drift = 0 yazıyordu. Yani "bankayla arasında X TL fark vardı" gözlemi, tam da
-- onu tutması gereken tablodan siliniyordu: para izi card_ledger'da duruyor ama
-- mutabakat geçmişi olayı hiç yaşanmamış gibi gösteriyordu. Sonucu somut —
-- buildReconciliationItems drift=0 gördüğü için kartı 'ok' sayıyor, modülün
-- baştan hedeflediği "sapma trendi" hiç oluşamıyordu.
--
-- Bundan sonra drift DAİMA ham ölçümdür (app_amount − real_amount) ve düzeltme
-- yapılsa bile değişmez. "Ne oldu" bilgisi ayrı bir kolona taşınır:
--   matched   : ölçümde fark çıkmadı
--   open      : fark kaydedildi, düzeltilmedi (aksiyon bekliyor)
--   corrected : fark kaydedildi ve ledger düzeltmesi uygulandı
--
-- Eski satırlarda gerçek fark kalıcı olarak kaybolduğu (düzeltme öncesi
-- app_amount hiç yazılmamış) için resolution NULL kalır = "bilinmiyor".
-- Okuma tarafı bu satırlarda eski davranışa düşer; uydurma veri üretilmez.
--
-- Bilerek EKLENMEYEN kolon: uygulanan düzeltme tutarı. Her iki akışta da tam
-- olarak -drift'e eşit, yani satırdan türetilebilir — bu migration'ın düzelttiği
-- hatanın (türetilebilir değeri korumasız saklamak) aynısı olurdu. Kısmi
-- düzeltme mümkün olduğu gün kolon hak edilerek eklenir.

alter table public.account_reconciliations
  add column if not exists resolution text;

alter table public.account_reconciliations
  drop constraint if exists account_reconciliations_resolution_check;
alter table public.account_reconciliations
  add constraint account_reconciliations_resolution_check
  check (resolution is null or resolution in ('matched', 'open', 'corrected'));

-- drift türetilmiş bir alan: satır içinde tutarlı olmak ZORUNDA. Üç kolon da
-- numeric(14,2) olduğu için eşitlik tolerans gerektirmez.
-- NOT VALID bilinçli: yukarıdaki karar gereği eski satırlar olduğu gibi kalır,
-- yeni ve güncellenen satırlar kısıtlanır.
alter table public.account_reconciliations
  drop constraint if exists account_reconciliations_drift_matches;
alter table public.account_reconciliations
  add constraint account_reconciliations_drift_matches
  check (drift = app_amount - real_amount) not valid;

comment on column public.account_reconciliations.drift is
  'Ham ölçüm: app_amount - real_amount. Düzeltme uygulansa bile DEĞİŞTİRİLMEZ.';
comment on column public.account_reconciliations.resolution is
  'matched | open | corrected. NULL = bu kolondan önce yazılmış kayıt (bilinmiyor).';
