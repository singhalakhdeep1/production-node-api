CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename varchar(255) NOT NULL UNIQUE,
  original_name varchar(255) NOT NULL,
  mimetype varchar(100) NOT NULL,
  size bigint NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  todo_id uuid REFERENCES todos(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uploads_user_idx ON uploads (user_id, created_at DESC);
