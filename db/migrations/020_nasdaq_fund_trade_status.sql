ALTER TABLE nasdaq_fund_observations ADD COLUMN fund_trade_status TEXT CHECK (fund_trade_status IS NULL OR fund_trade_status IN ('open', 'limited', 'paused'));
ALTER TABLE nasdaq_fund_observations ADD COLUMN fund_daily_limit REAL CHECK (fund_daily_limit IS NULL OR fund_daily_limit >= 0);
