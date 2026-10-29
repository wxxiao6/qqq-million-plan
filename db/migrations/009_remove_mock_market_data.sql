-- 不把历史模拟扫描结果伪装为真实额度或真实净值。
DELETE FROM quota_cells WHERE source IN ('seed', 'mock');
DELETE FROM nav_snapshots WHERE source IN ('mock', 'auto');
