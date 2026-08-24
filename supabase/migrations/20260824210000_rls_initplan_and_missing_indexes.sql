-- Performans turu Faz 4a (2026-08-24)
--
-- 1) RLS initPlan düzeltmesi: çıplak `auth.uid()` policy içinde her satır için
--    yeniden değerlendirilir; `(select auth.uid())` bir kez hesaplanır
--    (Postgres initPlan). Depo geneli bu deseni 20260503133000'te uygulamıştı;
--    o tarihten SONRA eklenen beş tablo şablonun eski halini kopyalamış.
--    Policy semantiği birebir aynı kalır, yalnız değerlendirme planı değişir.
--
-- 2) Eksik indeksler: `wishlist_items` PK dışında indekssiz tek tabloydu (RLS
--    her okumada user_id süzer). Kalanlar cascade/set-null FK kolonları —
--    parent satır silinirken child tablo seq-scan yerine indeksten bulunur.

-- ---------------------------------------------------------------------------
-- 1) Policy'ler: aynı ad, aynı kapsam, initPlan'lı gövde
-- ---------------------------------------------------------------------------

drop policy if exists "own rows" on public.wishlist_items;
create policy "own rows" on public.wishlist_items
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own rows" on public.kasa_buckets;
create policy "own rows" on public.kasa_buckets
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own rows" on public.notification_preferences;
create policy "own rows" on public.notification_preferences
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own rows" on public.cars;
create policy "own rows" on public.cars
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own rows" on public.savings_goal_sources;
create policy "own rows" on public.savings_goal_sources
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2) Eksik indeksler
-- ---------------------------------------------------------------------------

create index if not exists wishlist_items_user_idx
  on public.wishlist_items (user_id);

-- savings_goal_sources: goal_id/user_id indeksli, kaynak referansları değildi.
-- Varlık/kart/kova silindiğinde cascade bu kolonlardan child arar.
create index if not exists savings_goal_sources_asset_idx
  on public.savings_goal_sources (asset_id);
create index if not exists savings_goal_sources_card_idx
  on public.savings_goal_sources (card_id);
create index if not exists savings_goal_sources_bucket_idx
  on public.savings_goal_sources (bucket_id);
create index if not exists savings_goal_sources_component_idx
  on public.savings_goal_sources (component_id);

-- card_installment_intents: mevcut (user_id, status, expires_at) indeksi FK
-- kolonlarını kapsamıyor.
create index if not exists card_installment_intents_card_idx
  on public.card_installment_intents (card_id);
create index if not exists card_installment_intents_consumed_expense_idx
  on public.card_installment_intents (consumed_expense_id);

-- card_statement_payments: user/archive indeksli; kart FK'leri değildi.
create index if not exists card_statement_payments_card_idx
  on public.card_statement_payments (card_id);
create index if not exists card_statement_payments_source_card_idx
  on public.card_statement_payments (source_card_id);
