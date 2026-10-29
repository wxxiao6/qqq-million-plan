-- 纳指定投计划。用户资产账本，与持仓同域；不写入额度表。

CREATE TABLE IF NOT EXISTS dca_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  share_class TEXT NOT NULL CHECK (share_class IN ('A', 'C', 'I', 'F')),
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
  updated_at TEXT NOT NULL
);
