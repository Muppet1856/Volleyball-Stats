-- Upgrade existing databases with revision tracking for optimistic concurrency
ALTER TABLE matches ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT CURRENT_TIMESTAMP;
UPDATE matches SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_matches_updated_at ON matches(updated_at);
