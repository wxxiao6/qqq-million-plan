-- User accounts, sessions and one-time initial owner setup.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_expiry ON user_sessions (expires_at);

CREATE TABLE auth_login_limits (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at TEXT NOT NULL
);

ALTER TABLE positions ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE dca_plans ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE portfolio_snapshots ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX idx_positions_user_id ON positions (user_id, id);
CREATE INDEX idx_positions_user_dca_execution ON positions (user_id, dca_plan_id, execution_on);
CREATE INDEX idx_dca_plans_user_status ON dca_plans (user_id, status, next_debit_date);
CREATE INDEX idx_portfolio_snapshots_user_date ON portfolio_snapshots (user_id, as_of);

-- The product is configured for one private owner account. These triggers
-- attach subsequent ledger writes to that owner, including scheduled writes.
CREATE TRIGGER positions_assign_owner AFTER INSERT ON positions
WHEN NEW.user_id IS NULL
BEGIN
  UPDATE positions SET user_id=(SELECT id FROM users WHERE role='admin' LIMIT 1) WHERE id=NEW.id;
END;

CREATE TRIGGER dca_plans_assign_owner AFTER INSERT ON dca_plans
WHEN NEW.user_id IS NULL
BEGIN
  UPDATE dca_plans SET user_id=(SELECT id FROM users WHERE role='admin' LIMIT 1) WHERE id=NEW.id;
END;

CREATE TRIGGER portfolio_snapshots_assign_owner AFTER INSERT ON portfolio_snapshots
WHEN NEW.user_id IS NULL
BEGIN
  UPDATE portfolio_snapshots SET user_id=(SELECT id FROM users WHERE role='admin' LIMIT 1) WHERE as_of=NEW.as_of;
END;

CREATE TABLE user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
