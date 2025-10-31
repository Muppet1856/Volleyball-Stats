-- Add revision column for optimistic concurrency control when missing.
ALTER TABLE matches ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

-- Add updated_at column to preserve last-modified metadata for each match.
ALTER TABLE matches ADD COLUMN updated_at TEXT;

-- Ensure existing rows start with consistent values.
UPDATE matches
SET
  revision = COALESCE(revision, 0),
  updated_at = COALESCE(updated_at, created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE INDEX IF NOT EXISTS idx_matches_updated_at ON matches(updated_at);
