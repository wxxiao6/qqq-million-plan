-- Replace just the constrained theme column. Keep the parent table and all
-- referencing quote/evidence rows in place (DROP TABLE would cascade them).
DROP TRIGGER radar_fund_identity_insert;
DROP TRIGGER radar_fund_identity_update;
DROP INDEX idx_nasdaq_funds_theme;
ALTER TABLE nasdaq_funds ADD COLUMN theme_next TEXT NOT NULL DEFAULT 'nasdaq_100'
  CHECK(theme_next IN ('nasdaq_100','nasdaq_biotech','nasdaq_technology','nasdaq_selected','sp500','gold'));
UPDATE nasdaq_funds SET theme_next=theme;
ALTER TABLE nasdaq_funds DROP COLUMN theme;
ALTER TABLE nasdaq_funds RENAME COLUMN theme_next TO theme;
CREATE INDEX idx_nasdaq_funds_theme ON nasdaq_funds(theme,venue);

-- Public radar membership no longer implies Nasdaq exposure.
CREATE TRIGGER radar_fund_identity_insert AFTER INSERT ON nasdaq_funds BEGIN
  INSERT INTO funds(code,name,manager,fund_type,currency,venue,is_nasdaq,source_url,updated_at)
  VALUES(NEW.code,NEW.name,NEW.manager,NEW.product_type,NEW.currency,NEW.venue,
    CASE WHEN NEW.theme LIKE 'nasdaq_%' THEN 1 ELSE 0 END,NEW.source_url,NEW.observed_on)
  ON CONFLICT(code) DO UPDATE SET name=excluded.name,manager=excluded.manager,
    currency=excluded.currency,venue=excluded.venue,is_nasdaq=excluded.is_nasdaq,updated_at=excluded.updated_at;
END;
CREATE TRIGGER radar_fund_identity_update AFTER UPDATE ON nasdaq_funds BEGIN
  INSERT INTO funds(code,name,manager,fund_type,currency,venue,is_nasdaq,source_url,updated_at)
  VALUES(NEW.code,NEW.name,NEW.manager,NEW.product_type,NEW.currency,NEW.venue,
    CASE WHEN NEW.theme LIKE 'nasdaq_%' THEN 1 ELSE 0 END,NEW.source_url,NEW.observed_on)
  ON CONFLICT(code) DO UPDATE SET name=excluded.name,manager=excluded.manager,
    currency=excluded.currency,venue=excluded.venue,is_nasdaq=excluded.is_nasdaq,updated_at=excluded.updated_at;
END;
