-- Lưu bản tin tổng quan rổ VN30 mỗi phiên, do AI sinh sau khi ETL xong.

CREATE TABLE IF NOT EXISTS market_briefs (
  trade_date  date        PRIMARY KEY,
  content     text        NOT NULL,
  model       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_briefs_created_idx ON market_briefs (created_at DESC);
