BEGIN TRANSACTION;

-- Add revision column for optimistic concurrency control when missing.
ALTER TABLE matches ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

-- Add updated_at column to preserve last-modified metadata for each match.
ALTER TABLE matches ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP;

-- Backfill updated_at so existing rows retain a sensible timestamp.
UPDATE matches
SET updated_at = COALESCE(updated_at, created_at)
WHERE updated_at IS NULL;

-- Index the timestamp to keep chronological queries efficient.
CREATE INDEX IF NOT EXISTS idx_matches_updated_at ON matches(updated_at);

COMMIT;
