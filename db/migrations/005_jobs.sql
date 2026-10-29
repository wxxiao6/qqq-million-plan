-- 定时任务：在途定投可空份额；净值快照带来源（手填不覆盖）。

ALTER TABLE nav_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'auto';

PRAGMA foreign_keys = OFF;

CREATE TABLE positions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL CHECK (account IN ('alipay', 'gf_direct', 'cmb', 'other')),
  exposure TEXT NOT NULL CHECK (exposure IN ('nasdaq', 'gold')),
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

PRAGMA foreign_keys = ON;
