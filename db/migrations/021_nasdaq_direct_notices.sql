ALTER TABLE nasdaq_funds ADD COLUMN manager TEXT;

-- Keep the official notice events so a later change can supersede an earlier limit.
CREATE TABLE IF NOT EXISTS nasdaq_direct_notice_events (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('online', 'counter', 'all')),
  status TEXT NOT NULL CHECK (status IN ('open', 'limited', 'paused')),
  daily_limit REAL CHECK (daily_limit IS NULL OR daily_limit >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('CNY', 'USD')),
  effective_on TEXT NOT NULL,
  published_on TEXT NOT NULL,
  source_url TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  UNIQUE (code, method, effective_on, source_url)
);

CREATE INDEX IF NOT EXISTS idx_nasdaq_direct_events_current
  ON nasdaq_direct_notice_events(code, effective_on DESC, published_on DESC);
