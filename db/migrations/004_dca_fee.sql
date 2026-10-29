-- 定投计划手续费：费率(%) 或固定金额(元)。可空；P0 只落计划，不做汇总看板。

ALTER TABLE dca_plans ADD COLUMN fee_kind TEXT
  CHECK (fee_kind IS NULL OR fee_kind IN ('rate', 'fixed'));

ALTER TABLE dca_plans ADD COLUMN fee_value REAL
  CHECK (fee_value IS NULL OR fee_value >= 0);
