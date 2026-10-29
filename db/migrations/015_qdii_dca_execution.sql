-- QDII 定投执行记录：实际扣款总额、手续费、T 日 NAV 与实际确认日。
ALTER TABLE positions ADD COLUMN dca_plan_id INTEGER;
ALTER TABLE positions ADD COLUMN cash_debited REAL;
ALTER TABLE positions ADD COLUMN fee_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE positions ADD COLUMN t_nav REAL;
ALTER TABLE positions ADD COLUMN confirmed_on TEXT;

UPDATE positions
SET cash_debited = cost
WHERE cash_debited IS NULL;

CREATE INDEX IF NOT EXISTS idx_positions_dca_execution
  ON positions (dca_plan_id, recorded_on);
