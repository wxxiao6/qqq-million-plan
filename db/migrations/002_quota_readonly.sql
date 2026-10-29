-- 额度只读看板：作用域、来源、业务日期；预留购买占用表。
-- SQLite 无法直接改 CHECK，需重建 quota_cells。

PRAGMA foreign_keys = OFF;

CREATE TABLE quota_cells_new (
  symbol TEXT NOT NULL,
  share_class TEXT NOT NULL,
  channel_kind TEXT NOT NULL CHECK (channel_kind IN ('direct', 'agency')),
  status TEXT NOT NULL CHECK (status IN ('open', 'limited', 'paused')),
  daily_limit REAL,
  quota_scope TEXT,
  source TEXT,
  biz_date TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (symbol, share_class, channel_kind),
  FOREIGN KEY (symbol, share_class) REFERENCES quota_universe (symbol, share_class)
);

INSERT INTO quota_cells_new (
  symbol, share_class, channel_kind, status, daily_limit,
  quota_scope, source, biz_date, updated_at
)
SELECT
  symbol,
  share_class,
  channel_kind,
  status,
  daily_limit,
  symbol || ':' || share_class || ':' || channel_kind,
  NULL,
  NULL,
  updated_at
FROM quota_cells;

DROP TABLE quota_cells;
ALTER TABLE quota_cells_new RENAME TO quota_cells;

CREATE TABLE IF NOT EXISTS quota_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quota_scope TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'released')),
  biz_date TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA foreign_keys = ON;
