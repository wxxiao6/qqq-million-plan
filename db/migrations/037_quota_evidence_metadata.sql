-- Preserve the evidence that explains each AI-collected quota value.
ALTER TABLE quota_observations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'official_page';
ALTER TABLE quota_observations ADD COLUMN source_published_at TEXT;
ALTER TABLE quota_observations ADD COLUMN evidence_locator TEXT;
ALTER TABLE quota_observations ADD COLUMN source_hash TEXT;

ALTER TABLE quota_current ADD COLUMN source_type TEXT NOT NULL DEFAULT 'official_page';
ALTER TABLE quota_current ADD COLUMN source_published_at TEXT;
ALTER TABLE quota_current ADD COLUMN evidence_locator TEXT;
ALTER TABLE quota_current ADD COLUMN source_hash TEXT;

ALTER TABLE quota_exchange_observations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'official_page';
ALTER TABLE quota_exchange_observations ADD COLUMN source_published_at TEXT;
ALTER TABLE quota_exchange_observations ADD COLUMN evidence_locator TEXT;
ALTER TABLE quota_exchange_observations ADD COLUMN source_hash TEXT;

ALTER TABLE quota_exchange_current ADD COLUMN source_type TEXT NOT NULL DEFAULT 'official_page';
ALTER TABLE quota_exchange_current ADD COLUMN source_published_at TEXT;
ALTER TABLE quota_exchange_current ADD COLUMN evidence_locator TEXT;
ALTER TABLE quota_exchange_current ADD COLUMN source_hash TEXT;
