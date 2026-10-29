-- 为已存在的定投执行记录补保存实际扣款日；T 日仍由 positions.recorded_on 表示。
ALTER TABLE positions ADD COLUMN execution_on TEXT;

UPDATE positions
SET execution_on = recorded_on
WHERE execution_on IS NULL;
