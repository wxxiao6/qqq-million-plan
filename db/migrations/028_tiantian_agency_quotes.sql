-- Keep the agency sales-page observation separate from CSRC announcement rules.
CREATE TABLE nasdaq_tiantian_agency_quotes (
  code TEXT PRIMARY KEY REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  status TEXT CHECK (status IS NULL OR status IN ('open', 'limited', 'paused')),
  daily_limit REAL CHECK (daily_limit IS NULL OR daily_limit >= 0),
  purchase_fee_pct REAL CHECK (purchase_fee_pct IS NULL OR purchase_fee_pct >= 0),
  source_url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
