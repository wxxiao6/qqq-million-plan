-- Canonical ingestion history for the configured Nasdaq fund catalog.
CREATE TABLE IF NOT EXISTS fund_nav_history (
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  nav_date TEXT NOT NULL,
  nav REAL NOT NULL CHECK (nav > 0),
  daily_change_pct REAL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, nav_date, source)
);

CREATE INDEX IF NOT EXISTS idx_fund_nav_history_latest
  ON fund_nav_history(code, nav_date DESC);

CREATE TABLE IF NOT EXISTS fund_info_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  name TEXT,
  full_name TEXT,
  fund_type TEXT,
  manager TEXT,
  raw_json TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE(code, source, fetched_at)
);

CREATE TABLE IF NOT EXISTS quota_ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_provider TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted', 'rejected')),
  error_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL REFERENCES quota_ingestion_runs(idempotency_key),
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  share_class TEXT NOT NULL,
  channel_kind TEXT NOT NULL CHECK(channel_kind IN ('direct', 'agency')),
  status TEXT NOT NULL CHECK(status IN ('open', 'limited', 'paused')),
  daily_limit REAL CHECK(daily_limit IS NULL OR daily_limit >= 0),
  currency TEXT NOT NULL CHECK(currency IN ('CNY', 'USD')),
  quota_scope TEXT,
  effective_on TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(idempotency_key, code, share_class, channel_kind)
);

CREATE TABLE IF NOT EXISTS quota_current (
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  share_class TEXT NOT NULL,
  channel_kind TEXT NOT NULL CHECK(channel_kind IN ('direct', 'agency')),
  status TEXT NOT NULL CHECK(status IN ('open', 'limited', 'paused')),
  daily_limit REAL CHECK(daily_limit IS NULL OR daily_limit >= 0),
  currency TEXT NOT NULL CHECK(currency IN ('CNY', 'USD')),
  quota_scope TEXT,
  effective_on TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(code, share_class, channel_kind)
);

CREATE TABLE IF NOT EXISTS fund_ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  biz_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  requested_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  error_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'partial', 'failed')),
  UNIQUE(job_name, biz_date)
);
