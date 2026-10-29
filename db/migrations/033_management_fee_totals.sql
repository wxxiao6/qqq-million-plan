-- 管理费只保存累计结果和最后处理到的净值日，不保存自动生成的逐日扣除记录。
CREATE TABLE IF NOT EXISTS holding_management_fee_totals (
  symbol TEXT NOT NULL REFERENCES nasdaq_funds(code) ON DELETE CASCADE,
  account TEXT NOT NULL CHECK (account IN ('alipay', 'gf_direct', 'cmb', 'jd', 'other')),
  estimated_amount REAL NOT NULL DEFAULT 0 CHECK (estimated_amount >= 0),
  actual_amount REAL NOT NULL DEFAULT 0 CHECK (actual_amount >= 0),
  last_nav_date TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (symbol, account)
);

CREATE INDEX IF NOT EXISTS idx_holding_management_fee_totals_date
  ON holding_management_fee_totals(last_nav_date);
