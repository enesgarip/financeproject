-- Add gold and USD rates to net_worth_snapshots so each snapshot
-- records the exchange rates that were live when it was taken.
-- These columns power the "gram altın / USD cinsinden net değer" toggle.

ALTER TABLE net_worth_snapshots
  ADD COLUMN IF NOT EXISTS gold_try NUMERIC,
  ADD COLUMN IF NOT EXISTS usd_try  NUMERIC;

COMMENT ON COLUMN net_worth_snapshots.gold_try IS 'Gram altın TRY buying rate at snapshot time (truncgil GRA buying)';
COMMENT ON COLUMN net_worth_snapshots.usd_try  IS 'USD/TRY buying rate at snapshot time (truncgil USD buying)';
