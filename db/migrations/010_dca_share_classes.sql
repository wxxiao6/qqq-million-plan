-- 定投计划支持人民币 D/E 类；美元份额仍由业务层排除。

CREATE TABLE dca_plans_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exposure TEXT NOT NULL DEFAULT 'nasdaq' CHECK (exposure IN ('nasdaq', 'gold', 'crypto')),
  symbol TEXT NOT NULL,
  share_class TEXT NOT NULL CHECK (share_class IN ('A', 'C', 'D', 'E', 'I', 'F')),
  channel_kind TEXT NOT NULL CHECK (channel_kind IN ('direct', 'agency')),
  account TEXT CHECK (account IS NULL OR account IN ('alipay', 'gf_direct', 'cmb', 'other')),
  amount REAL NOT NULL CHECK (amount > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  weekday INTEGER CHECK (weekday IS NULL OR (weekday >= 1 AND weekday <= 7)),
  month_day INTEGER CHECK (month_day IS NULL OR (month_day >= 1 AND month_day <= 28)),
  start_date TEXT NOT NULL,
  next_debit_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  note TEXT,
  updated_at TEXT NOT NULL,
  fee_kind TEXT CHECK (fee_kind IS NULL OR fee_kind IN ('rate', 'fixed')),
  fee_value REAL CHECK (fee_value IS NULL OR fee_value >= 0)
);

INSERT INTO dca_plans_new (
  id, exposure, symbol, share_class, channel_kind, account, amount, frequency,
  weekday, month_day, start_date, next_debit_date, status, note, updated_at,
  fee_kind, fee_value
)
SELECT
  id, exposure, symbol, share_class, channel_kind, account, amount, frequency,
  weekday, month_day, start_date, next_debit_date, status, note, updated_at,
  fee_kind, fee_value
FROM dca_plans;

DROP TABLE dca_plans;
ALTER TABLE dca_plans_new RENAME TO dca_plans;
