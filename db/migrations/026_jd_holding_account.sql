-- Keep the existing position lifecycle and add 京东 as a distinct agency account.
CREATE TABLE positions_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL CHECK (account IN ('alipay', 'gf_direct', 'cmb', 'jd', 'other')),
  exposure TEXT NOT NULL CHECK (exposure IN ('nasdaq', 'gold', 'crypto')),
  symbol TEXT NOT NULL,
  shares REAL,
  cost REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('settled', 'pending', 'failed', 'cancelled')),
  note TEXT,
  recorded_on TEXT,
  updated_at TEXT NOT NULL,
  expected_confirm_on TEXT,
  dca_plan_id INTEGER,
  cash_debited REAL,
  fee_amount REAL NOT NULL DEFAULT 0,
  t_nav REAL,
  confirmed_on TEXT,
  execution_on TEXT,
  cutoff_period TEXT CHECK (cutoff_period IS NULL OR cutoff_period IN ('before_15', 'after_15')),
  t_date TEXT,
  order_origin TEXT CHECK (order_origin IS NULL OR order_origin IN ('manual', 'dca')),
  closed_on TEXT
);

INSERT INTO positions_next SELECT * FROM positions;
DROP TABLE positions;
ALTER TABLE positions_next RENAME TO positions;
CREATE INDEX idx_positions_dca_execution ON positions (dca_plan_id, execution_on);
CREATE INDEX idx_positions_pending ON positions (status, exposure, symbol);
