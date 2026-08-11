-- Faz D3: Otomatik değerlemede "ne zaman, hangi kurla" bilgisi saklanmıyordu.
--
-- assets / debts / savings_goals üzerinde estimated_value_try + auto_valued var
-- ama değerlemenin YAŞI yoktu. `updated_at` bu işi göremez: kullanıcı notu
-- değiştirince de ilerler, yani "bu rakam ne kadar taze" sorusunu cevaplamaz.
-- effectiveAssetValue canlı kur gelmediğinde sessizce saklı değere düşüyor;
-- kullanıcı 3 gün önceki kurla hesaplanmış bir tutarı canlı sanıyordu.
--
-- net_worth_snapshots bu deseni zaten doğru uyguluyor (değerle birlikte gold_try
-- + usd_try satırda duruyor). Aynı desen varlık/borç/hedef satırına taşınıyor.
--
-- valuation_rate NEDEN saklanıyor (türetilebilir görünüyor ama değil):
-- kabaca estimated_value_try / amount'a eşittir, ama `amount` kullanıcı
-- tarafından sonradan değiştirilebilir ve miktarın geçmişi tutulmuyor. Miktar
-- değişir değişmez oran geri hesaplanamaz hale gelir; kullanılan kur o ana ait
-- bir piyasa gerçeğidir, türetilmiş bir alan değildir.

alter table public.assets
  add column if not exists valued_at timestamptz,
  add column if not exists valuation_rate numeric(18, 6);

alter table public.debts
  add column if not exists valued_at timestamptz,
  add column if not exists valuation_rate numeric(18, 6);

alter table public.savings_goals
  add column if not exists valued_at timestamptz,
  add column if not exists valuation_rate numeric(18, 6);

-- Oran negatif olamaz; 0 da "kur alınamadı" demek olurdu, o durumda NULL yazılır.
alter table public.assets drop constraint if exists assets_valuation_rate_check;
alter table public.assets add constraint assets_valuation_rate_check
  check (valuation_rate is null or valuation_rate > 0);

alter table public.debts drop constraint if exists debts_valuation_rate_check;
alter table public.debts add constraint debts_valuation_rate_check
  check (valuation_rate is null or valuation_rate > 0);

alter table public.savings_goals drop constraint if exists savings_goals_valuation_rate_check;
alter table public.savings_goals add constraint savings_goals_valuation_rate_check
  check (valuation_rate is null or valuation_rate > 0);

comment on column public.assets.valued_at is
  'estimated_value_try en son ne zaman otomatik hesaplandı. NULL = elle girilmiş ya da bu kolondan önceki kayıt.';
comment on column public.assets.valuation_rate is
  'Hesapta kullanılan birim TL fiyatı (gram altın / döviz kuru / hisse fiyatı). O ana ait piyasa gerçeği.';
comment on column public.debts.valued_at is
  'estimated_value_try en son ne zaman otomatik hesaplandı. NULL = elle girilmiş ya da bu kolondan önceki kayıt.';
comment on column public.debts.valuation_rate is
  'Hesapta kullanılan birim TL fiyatı. Borçta satış (Satış) tarafı kullanılır.';
comment on column public.savings_goals.valued_at is
  'estimated_value_try en son ne zaman otomatik hesaplandı. NULL = elle girilmiş ya da bu kolondan önceki kayıt.';
comment on column public.savings_goals.valuation_rate is
  'Hesapta kullanılan birim TL fiyatı.';
