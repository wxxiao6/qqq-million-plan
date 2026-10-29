-- 场内 ETF / LOF：保存成交价与报价时间，用于只读展示溢价率。
ALTER TABLE nav_snapshots ADD COLUMN market_price REAL;
ALTER TABLE nav_snapshots ADD COLUMN market_price_at TEXT;
