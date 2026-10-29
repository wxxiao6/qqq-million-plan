-- Quota status and limits must be backed by the unified disclosure platform.
-- Keep purchase fees gathered from the sales page, but discard old quota readings.
UPDATE nasdaq_channel_quotes
SET status = NULL, daily_limit = NULL, limit_scope = NULL
WHERE channel_kind IN ('direct', 'agency')
  AND source_url NOT LIKE 'http://eid.csrc.gov.cn/fund/disclose/%'
  AND source_url NOT LIKE 'https://eid.csrc.gov.cn/fund/disclose/%';

UPDATE nasdaq_fund_observations
SET fund_trade_status = NULL, fund_daily_limit = NULL;
