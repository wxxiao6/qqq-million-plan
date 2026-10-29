-- Share metadata lives with the single Nasdaq membership table.
ALTER TABLE nasdaq_funds ADD COLUMN share_class TEXT NOT NULL DEFAULT 'A' CHECK (share_class IN ('A', 'C', 'D', 'E', 'F', 'I'));
ALTER TABLE nasdaq_funds ADD COLUMN market_type TEXT NOT NULL DEFAULT 'otc' CHECK (market_type IN ('otc', 'etf', 'lof'));
ALTER TABLE nasdaq_funds ADD COLUMN min_order REAL NOT NULL DEFAULT 10 CHECK (min_order >= 0);
