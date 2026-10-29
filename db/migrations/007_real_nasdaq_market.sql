-- 真实纳指市场：支持 D/E 类与美元份额，并保存官方净值日涨跌和来源。

PRAGMA foreign_keys = OFF;

CREATE TABLE quota_universe_new (
  symbol TEXT NOT NULL,
  share_class TEXT NOT NULL CHECK (share_class IN ('A', 'C', 'D', 'E', 'F', 'I')),
  name TEXT NOT NULL,
  manager TEXT,
  min_order REAL NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK (currency IN ('CNY', 'USD')),
  market_type TEXT NOT NULL DEFAULT 'otc' CHECK (market_type IN ('otc', 'etf', 'lof')),
  PRIMARY KEY (symbol, share_class)
);

INSERT INTO quota_universe_new (symbol, share_class, name, manager, min_order, active, currency, market_type)
SELECT symbol, share_class, name, manager, min_order, active, 'CNY', 'otc'
FROM quota_universe;

DROP TABLE quota_universe;
ALTER TABLE quota_universe_new RENAME TO quota_universe;

ALTER TABLE nav_snapshots ADD COLUMN nav_change_pct REAL;
ALTER TABLE nav_snapshots ADD COLUMN source_url TEXT;

PRAGMA foreign_keys = ON;
