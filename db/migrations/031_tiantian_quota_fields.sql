ALTER TABLE quota_current ADD COLUMN purchase_fee_pct REAL;
ALTER TABLE quota_current ADD COLUMN purchase_fee_json TEXT;

ALTER TABLE quota_observations ADD COLUMN purchase_fee_pct REAL;
ALTER TABLE quota_observations ADD COLUMN purchase_fee_json TEXT;
