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
  jersey_color_home TEXT,
  jersey_color_opp TEXT,
  result_home INTEGER,
  result_opp INTEGER,
  first_server TEXT,
  players TEXT,
  sets TEXT,
  finalized_sets TEXT,
  is_swapped INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
