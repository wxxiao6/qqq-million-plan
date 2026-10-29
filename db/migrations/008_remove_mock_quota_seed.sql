-- 真实市场上线后，演示额度不能出现在用户的只读雷达中。
DELETE FROM quota_cells WHERE source = 'seed';
