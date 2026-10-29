-- Project the remaining official quota readings from the legacy matrix into
-- the canonical quota projection.  The DCA and radar readers no longer read
-- quota_cells directly, so leaving these rows behind makes valid direct-only
-- funds disappear from channel searches after the quota schema migration.
INSERT OR IGNORE INTO quota_current (
  code,
  share_class,
  channel_kind,
  status,
  daily_limit,
  currency,
  quota_scope,
  effective_on,
  observed_at,
  source_url,
  source_provider,
  updated_at
)
SELECT
  c.symbol,
  c.share_class,
  c.channel_kind,
  c.status,
  c.daily_limit,
  f.currency,
  c.quota_scope,
  c.biz_date,
  c.updated_at,
  c.source,
  'legacy-quota-cells',
  c.updated_at
FROM quota_cells c
JOIN nasdaq_funds f
  ON f.code = c.symbol
 AND f.share_class = c.share_class
WHERE c.status IN ('open', 'limited', 'paused')
  AND c.biz_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM quota_current current_row
    WHERE current_row.code = c.symbol
      AND current_row.share_class = c.share_class
      AND current_row.channel_kind = c.channel_kind
  );
