ALTER TABLE dca_plans ADD COLUMN imported_through TEXT;
ALTER TABLE dca_plans ADD COLUMN cutoff_period TEXT NOT NULL DEFAULT 'before_15' CHECK (cutoff_period IN ('before_15', 'after_15'));
ALTER TABLE positions ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0;
