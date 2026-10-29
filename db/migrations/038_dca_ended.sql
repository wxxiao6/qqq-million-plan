-- Keep ended plans and their ledger links without changing the legacy status constraint.
ALTER TABLE dca_plans ADD COLUMN ended_at TEXT;
