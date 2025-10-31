-- Initial schema for Volleyball Stats application
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL,
  last_name TEXT NOT NULL,
  initial TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  location TEXT,
  types TEXT,
  opponent TEXT,
  jersey_color_sc TEXT,
  jersey_color_opp TEXT,
  result_sc INTEGER,
  result_opp INTEGER,
  first_server TEXT,
  players TEXT,
  sets TEXT,
  finalized_sets TEXT,
  is_swapped INTEGER DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
