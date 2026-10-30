-- Retire the legacy quota matrix; current channel quotas live in quota_current.
DROP TABLE IF EXISTS quota_cells;
DROP TABLE IF EXISTS quota_status_log;
DROP TABLE IF EXISTS quota_universe;
