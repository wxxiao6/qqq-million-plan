-- Retire quota values previously copied from the sales page into the older matrix.
-- The disclosure refresh will repopulate verified rows from official notices.
DELETE FROM quota_cells
WHERE source IN ('tiantian-fund-page', 'eastmoney-f10')
   OR source LIKE 'https://fund.eastmoney.com/%';

UPDATE quota_universe
SET fund_status=NULL, fund_daily_limit=NULL, fund_source=NULL,
    fund_biz_date=NULL, fund_updated_at=NULL
WHERE fund_source IN ('tiantian-fund-page', 'eastmoney-f10')
   OR fund_source LIKE 'https://fund.eastmoney.com/%';
