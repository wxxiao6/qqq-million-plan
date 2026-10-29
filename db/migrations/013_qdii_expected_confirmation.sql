-- QDII 定投在扣款日先进入在途，按工作日 T+2 预计确认；正式净值到达后才转已确认。
ALTER TABLE positions ADD COLUMN expected_confirm_on TEXT;
