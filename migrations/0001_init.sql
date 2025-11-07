CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL,
  last_name TEXT NOT NULL,
  initial TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opponent TEXT,
  date TEXT,
  time TEXT,
  jersey_home INTEGER,
  jersey_opp INTEGER,
  first_server BOOLEAN, -- 0=home, 1=opp
  players_appeared JSON,
  location TEXT,
  type INTEGER,
  result_home INTEGER,
  result_opp INTEGER
);

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  set_number INTEGER NOT NULL,
  set_score_home INTEGER NOT NULL DEFAULT 0,
  set_score_opp INTEGER NOT NULL DEFAULT 0,
  UNIQUE (match_id, set_number),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);

