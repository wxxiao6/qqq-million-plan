-- Fund management fees are already reflected in NAV; remove the separate estimates.
DROP TABLE IF EXISTS holding_management_fee_entries;
DROP TABLE IF EXISTS holding_management_fee_totals;
DROP TABLE IF EXISTS fund_management_fee_rates;
DELETE FROM app_kv WHERE key='holdings.managementFeeStartDate';
