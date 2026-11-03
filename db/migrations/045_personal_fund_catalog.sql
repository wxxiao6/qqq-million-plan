-- Fund identity is independent of membership in the public Nasdaq radar.
CREATE TABLE funds (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manager TEXT,
  fund_type TEXT,
  currency TEXT NOT NULL CHECK(currency IN ('CNY','USD')),
  venue TEXT NOT NULL CHECK(venue IN ('otc','exchange')),
  is_nasdaq INTEGER NOT NULL DEFAULT 0 CHECK(is_nasdaq IN (0,1)),
  source_url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO funds(code,name,manager,fund_type,currency,venue,is_nasdaq,source_url,updated_at)
SELECT code,name,manager,product_type,currency,venue,1,source_url,observed_on FROM nasdaq_funds;
-- Reseeding radar membership must never delete personally discovered funds.
CREATE TRIGGER radar_fund_identity_insert AFTER INSERT ON nasdaq_funds BEGIN
  INSERT INTO funds(code,name,manager,fund_type,currency,venue,is_nasdaq,source_url,updated_at)
  VALUES(NEW.code,NEW.name,NEW.manager,NEW.product_type,NEW.currency,NEW.venue,1,NEW.source_url,NEW.observed_on)
  ON CONFLICT(code) DO UPDATE SET name=excluded.name,manager=excluded.manager,
    currency=excluded.currency,venue=excluded.venue,is_nasdaq=1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER radar_fund_identity_update AFTER UPDATE ON nasdaq_funds BEGIN
  INSERT INTO funds(code,name,manager,fund_type,currency,venue,is_nasdaq,source_url,updated_at)
  VALUES(NEW.code,NEW.name,NEW.manager,NEW.product_type,NEW.currency,NEW.venue,1,NEW.source_url,NEW.observed_on)
  ON CONFLICT(code) DO UPDATE SET name=excluded.name,manager=excluded.manager,
    currency=excluded.currency,venue=excluded.venue,is_nasdaq=1,updated_at=excluded.updated_at;
END;

CREATE TABLE fund_nav_history_next (
  code TEXT NOT NULL REFERENCES funds(code),
  nav_date TEXT NOT NULL,
  nav REAL NOT NULL CHECK(nav>0),
  daily_change_pct REAL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(code,nav_date,source)
);
INSERT INTO fund_nav_history_next SELECT * FROM fund_nav_history;
DROP TABLE fund_nav_history;
ALTER TABLE fund_nav_history_next RENAME TO fund_nav_history;
CREATE INDEX idx_fund_nav_history_latest ON fund_nav_history(code,nav_date DESC);

CREATE TABLE fund_nav_sync (
  code TEXT PRIMARY KEY REFERENCES funds(code),
  attempted_at TEXT NOT NULL,
  succeeded_at TEXT,
  nav_date TEXT,
  error TEXT
);

-- Preserve every existing field, index and owner trigger when adding general funds.
CREATE TABLE position_sequence_backup AS SELECT seq FROM sqlite_sequence WHERE name='positions';
CREATE TABLE positions_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL CHECK(account IN ('alipay','gf_direct','cmb','jd','other')),
  exposure TEXT NOT NULL CHECK(exposure IN ('nasdaq','fund','gold','crypto')),
  symbol TEXT NOT NULL,
  shares REAL,
  cost REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('settled','pending','failed','cancelled')),
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
  cutoff_period TEXT CHECK(cutoff_period IS NULL OR cutoff_period IN ('before_15','after_15')),
  t_date TEXT,
  order_origin TEXT CHECK(order_origin IS NULL OR order_origin IN ('manual','dca')),
  closed_on TEXT,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  user_id TEXT REFERENCES users(id)
);
INSERT INTO positions_next SELECT * FROM positions;
DROP TABLE positions;
ALTER TABLE positions_next RENAME TO positions;
INSERT INTO sqlite_sequence(name,seq) SELECT 'positions',0 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='positions');
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM position_sequence_backup),0)) WHERE name='positions';
DROP TABLE position_sequence_backup;
CREATE INDEX idx_positions_dca_execution ON positions(dca_plan_id,execution_on);
CREATE INDEX idx_positions_pending ON positions(status,exposure,symbol);
CREATE INDEX idx_positions_user_id ON positions(user_id,id);
CREATE INDEX idx_positions_user_dca_execution ON positions(user_id,dca_plan_id,execution_on);
CREATE TRIGGER positions_assign_owner AFTER INSERT ON positions WHEN NEW.user_id IS NULL BEGIN
  UPDATE positions SET user_id=(SELECT id FROM users WHERE role='admin' LIMIT 1) WHERE id=NEW.id;
END;

CREATE VIEW nav_sync_funds AS
SELECT code FROM nasdaq_funds
UNION
SELECT f.code FROM funds f JOIN positions p ON p.symbol=f.code
WHERE p.exposure IN ('nasdaq','fund') AND p.status IN ('settled','pending')
UNION
SELECT f.code FROM funds f JOIN dca_plans p ON p.symbol=f.code
WHERE p.exposure='nasdaq' AND p.status='active' AND p.ended_at IS NULL;
