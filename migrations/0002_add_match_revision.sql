-- Add revision tracking to matches
ALTER TABLE matches ADD COLUMN revision INTEGER DEFAULT 0;
