-- 纳指基金持有管理费：费率历史与平台实际扣费对账记录。
CREATE TABLE IF NOT EXISTS fund_management_fee_rates (
  code TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  effective_on TEXT NOT NULL,
  annual_rate_pct REAL CHECK (annual_rate_pct IS NULL OR annual_rate_pct >= 0),
  raw_value TEXT,
  source_url TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('valid', 'missing', 'invalid')),
  PRIMARY KEY (code, effective_on, source_provider)
);

CREATE INDEX IF NOT EXISTS idx_fund_management_fee_rates_latest
  ON fund_management_fee_rates(code, effective_on DESC);

CREATE TABLE IF NOT EXISTS holding_management_fee_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  account TEXT NOT NULL CHECK (account IN ('alipay', 'gf_direct', 'cmb', 'jd', 'other')),
  fee_date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (symbol, account, fee_date)
);

INSERT OR IGNORE INTO app_kv (key, value)
VALUES ('holdings.managementFeeStartDate', strftime('%Y-%m-%d', 'now'));
