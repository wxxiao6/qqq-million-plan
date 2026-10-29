-- AI-collected exchange-channel quota snapshots are kept separate from the
-- OTC direct/agency projection.  Exchange availability has a different
-- business meaning and must not be summed into the OTC radar totals.
CREATE TABLE IF NOT EXISTS quota_exchange_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL REFERENCES quota_ingestion_runs(idempotency_key),
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  share_class TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'limited', 'paused')),
  daily_limit REAL CHECK(daily_limit IS NULL OR daily_limit >= 0),
  currency TEXT NOT NULL CHECK(currency IN ('CNY', 'USD')),
  quota_scope TEXT,
  effective_on TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(idempotency_key, code, share_class)
);

CREATE TABLE IF NOT EXISTS quota_exchange_current (
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  share_class TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'limited', 'paused')),
  daily_limit REAL CHECK(daily_limit IS NULL OR daily_limit >= 0),
  currency TEXT NOT NULL CHECK(currency IN ('CNY', 'USD')),
  quota_scope TEXT,
  effective_on TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(code, share_class)
);
