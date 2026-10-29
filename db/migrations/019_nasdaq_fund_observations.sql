CREATE TABLE IF NOT EXISTS nasdaq_fund_observations (
  code TEXT PRIMARY KEY REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  nav REAL CHECK (nav IS NULL OR nav > 0),
  nav_date TEXT,
  daily_change_pct REAL,
  tracking_error_pct REAL CHECK (tracking_error_pct IS NULL OR tracking_error_pct >= 0),
  tracking_target TEXT,
  source_url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nasdaq_channel_quotes (
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  channel_kind TEXT NOT NULL CHECK (channel_kind IN ('direct', 'agency', 'exchange')),
  status TEXT CHECK (status IS NULL OR status IN ('open', 'limited', 'paused')),
  daily_limit REAL CHECK (daily_limit IS NULL OR daily_limit >= 0),
  purchase_fee_pct REAL CHECK (purchase_fee_pct IS NULL OR purchase_fee_pct >= 0),
  source_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (code, channel_kind)
);
