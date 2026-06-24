-- Mở rộng bảng giá VN30 với OHLCV đầy đủ.
-- Chạy 1 lần trên Supabase SQL editor.

ALTER TABLE vn30_daily_prices
  ADD COLUMN IF NOT EXISTS open_price  numeric,
  ADD COLUMN IF NOT EXISTS high_price  numeric,
  ADD COLUMN IF NOT EXISTS low_price   numeric,
  ADD COLUMN IF NOT EXISTS volume      bigint;

-- Cần unique key (ticker, trade_date) để upsert/backfill idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS vn30_daily_prices_ticker_date_uidx
  ON vn30_daily_prices (ticker, trade_date);
