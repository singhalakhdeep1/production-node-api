CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash varchar(64) NOT NULL UNIQUE,
  key_prefix varchar(16) NOT NULL,
  name varchar(100) NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["read"]',
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id, created_at DESC);
