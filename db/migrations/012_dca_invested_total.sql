-- 定投计划独立累计已过账金额；不从手工持仓成本反推，避免混入非定投买入。
ALTER TABLE dca_plans ADD COLUMN invested_total REAL NOT NULL DEFAULT 0;
