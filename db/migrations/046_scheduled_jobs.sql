CREATE TABLE scheduled_job_runs (
  job_name TEXT NOT NULL,
  slot TEXT NOT NULL,
  run_id TEXT NOT NULL,
  biz_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','partial','failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  requested_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  error_json TEXT,
  PRIMARY KEY(job_name,slot)
);

CREATE TABLE quota_collection_runs (
  run_id TEXT PRIMARY KEY,
  biz_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  expected_count INTEGER NOT NULL CHECK(expected_count>=0),
  collected_count INTEGER NOT NULL DEFAULT 0 CHECK(collected_count>=0),
  collection_status TEXT NOT NULL CHECK(collection_status IN ('collecting','collected','failed')),
  error_summary TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_quota_collection_day ON quota_collection_runs(biz_date,started_at DESC);
ALTER TABLE quota_ingestion_runs ADD COLUMN collection_run_id TEXT REFERENCES quota_collection_runs(run_id);
CREATE INDEX idx_quota_ingestion_collection ON quota_ingestion_runs(collection_run_id,status);
