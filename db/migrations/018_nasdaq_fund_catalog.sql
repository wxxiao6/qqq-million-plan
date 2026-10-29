-- Search results and sales evidence are independent of quota observations.
CREATE TABLE IF NOT EXISTS nasdaq_funds (
  code TEXT PRIMARY KEY CHECK (length(code) = 6),
  name TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('nasdaq_100', 'nasdaq_biotech', 'nasdaq_technology', 'nasdaq_selected')),
  product_type TEXT NOT NULL CHECK (product_type IN ('etf', 'etf_feeder', 'index', 'active')),
  venue TEXT NOT NULL CHECK (venue IN ('exchange', 'otc')),
  currency TEXT NOT NULL CHECK (currency IN ('CNY', 'USD')),
  source_url TEXT NOT NULL,
  detail_url TEXT NOT NULL,
  observed_on TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nasdaq_fund_sales_channels (
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  channel_kind TEXT NOT NULL CHECK (channel_kind IN ('direct', 'agency', 'exchange')),
  seller TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'unverified', 'unavailable')),
  evidence_url TEXT,
  evidence_note TEXT,
  checked_at TEXT,
  PRIMARY KEY (code, channel_kind, seller)
);

CREATE INDEX IF NOT EXISTS idx_nasdaq_funds_theme ON nasdaq_funds(theme, venue);
