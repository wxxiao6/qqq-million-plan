-- P0 产品规格字段。公开数据层（额度、热度、净值）与用户资产数据分表。

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL CHECK (account IN ('alipay', 'gf_direct', 'cmb', 'other')),
  exposure TEXT NOT NULL CHECK (exposure IN ('nasdaq', 'gold')),
  symbol TEXT NOT NULL,
  shares REAL NOT NULL,
  cost REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('settled', 'pending')),
  note TEXT,
  recorded_on TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank TEXT NOT NULL,
  principal REAL NOT NULL,
  rate REAL,
  start_date TEXT,
  maturity_date TEXT,
  can_prepay INTEGER NOT NULL DEFAULT 0 CHECK (can_prepay IN (0, 1))
);

CREATE TABLE IF NOT EXISTS mortgage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  remaining_principal REAL NOT NULL,
  monthly_payment REAL,
  remaining_terms INTEGER,
  rate_type TEXT CHECK (rate_type IS NULL OR rate_type IN ('fixed', 'floating')),
  payment_day INTEGER CHECK (payment_day IS NULL OR (payment_day >= 1 AND payment_day <= 28))
);

CREATE TABLE IF NOT EXISTS cash_balance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS prev_net_worth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  as_of TEXT,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS nav_snapshots (
  symbol TEXT NOT NULL,
  as_of TEXT NOT NULL,
  nav REAL NOT NULL,
  PRIMARY KEY (symbol, as_of)
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  as_of TEXT PRIMARY KEY,
  dynamic_mv REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_universe (
  symbol TEXT NOT NULL,
  share_class TEXT NOT NULL CHECK (share_class IN ('A', 'C', 'I', 'F')),
  name TEXT NOT NULL,
  manager TEXT,
  min_order REAL NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (symbol, share_class)
);

CREATE TABLE IF NOT EXISTS quota_cells (
  symbol TEXT NOT NULL,
  share_class TEXT NOT NULL,
  channel_kind TEXT NOT NULL CHECK (channel_kind IN ('direct', 'agency')),
  status TEXT NOT NULL CHECK (status IN ('open', 'limited', 'paused')),
  daily_limit REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (symbol, share_class, channel_kind),
  FOREIGN KEY (symbol, share_class) REFERENCES quota_universe (symbol, share_class)
);

CREATE TABLE IF NOT EXISTS quota_status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  share_class TEXT NOT NULL,
  channel_kind TEXT NOT NULL CHECK (channel_kind IN ('direct', 'agency')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
