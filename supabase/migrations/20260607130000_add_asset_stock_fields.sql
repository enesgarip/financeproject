-- Add stock (BIST equity) fields to assets so 'Hisse' rows can be auto-valued
-- from live prices and show profit/loss against their cost basis.
--   symbol     : BIST ticker without the .IS suffix (e.g. 'THYAO'); uppercased.
--   unit_cost  : average purchase cost per share in TRY (birim/ortalama maliyet).
-- Quantity reuses the existing `amount` column; current value reuses
-- `estimated_value_try` (price × amount, kept fresh by the valuation sync).

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS symbol    TEXT,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC;

COMMENT ON COLUMN assets.symbol    IS 'BIST ticker without .IS suffix (Hisse only), e.g. THYAO';
COMMENT ON COLUMN assets.unit_cost IS 'Average purchase cost per share in TRY (Hisse only)';
