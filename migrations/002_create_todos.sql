CREATE TABLE IF NOT EXISTS todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(200) NOT NULL,
  description text,
  completed boolean NOT NULL DEFAULT false,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS todos_user_created_idx ON todos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS todos_user_completed_idx ON todos (user_id, completed);
