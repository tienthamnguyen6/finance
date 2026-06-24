-- Cache phân tích AI để không gọi lại GLM cho cùng (ticker, trade_date).

CREATE TABLE IF NOT EXISTS ai_analyses (
  ticker        text        NOT NULL,
  trade_date    date        NOT NULL,
  model         text        NOT NULL,
  content       text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, trade_date)
);

CREATE INDEX IF NOT EXISTS ai_analyses_created_idx ON ai_analyses (created_at DESC);
