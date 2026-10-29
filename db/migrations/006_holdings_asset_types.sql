-- 动态仓四类资产：持仓敞口增加加密货币；定投计划挂到资产类型。

PRAGMA foreign_keys = OFF;

CREATE TABLE positions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL CHECK (account IN ('alipay', 'gf_direct', 'cmb', 'other')),
  exposure TEXT NOT NULL CHECK (exposure IN ('nasdaq', 'gold', 'crypto')),
  symbol TEXT NOT NULL,
  shares REAL,
  cost REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('settled', 'pending')),
  note TEXT,
  recorded_on TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO positions_new (
  id, account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at
)
SELECT id, account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at
FROM positions;

DROP TABLE positions;
ALTER TABLE positions_new RENAME TO positions;

CREATE TABLE dca_plans_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exposure TEXT NOT NULL DEFAULT 'nasdaq' CHECK (exposure IN ('nasdaq', 'gold', 'crypto')),
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
  id, 'nasdaq', symbol, share_class, channel_kind, account, amount, frequency,
  weekday, month_day, start_date, next_debit_date, status, note, updated_at,
  fee_kind, fee_value
FROM dca_plans;

DROP TABLE dca_plans;
ALTER TABLE dca_plans_new RENAME TO dca_plans;

PRAGMA foreign_keys = ON;
