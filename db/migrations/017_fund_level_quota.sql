-- 天天基金详情页披露基金级额度，不能将同一读数写成直销与代销两笔。
ALTER TABLE quota_universe ADD COLUMN fund_status TEXT CHECK (fund_status IS NULL OR fund_status IN ('open', 'limited', 'paused'));
ALTER TABLE quota_universe ADD COLUMN fund_daily_limit REAL;
ALTER TABLE quota_universe ADD COLUMN fund_source TEXT;
ALTER TABLE quota_universe ADD COLUMN fund_biz_date TEXT;
ALTER TABLE quota_universe ADD COLUMN fund_updated_at TEXT;

-- 旧扫描把基金级读数复制到两个渠道，并用 :fund 标为共享；这些渠道格并非独立来源。
DELETE FROM quota_cells
WHERE quota_scope = symbol || ':' || share_class || ':fund';
