-- Normalize match set data into a dedicated table.
BEGIN TRANSACTION;

-- Recreate matches table without the deprecated JSON sets column.
CREATE TABLE matches_new (
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
  finalized_sets TEXT,
  is_swapped INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO matches_new (
  id,
  date,
  location,
  types,
  opponent,
  jersey_color_home,
  jersey_color_opp,
  result_home,
  result_opp,
  first_server,
  players,
  finalized_sets,
  is_swapped,
  created_at
)
SELECT
  id,
  date,
  location,
  types,
  opponent,
  jersey_color_home,
  jersey_color_opp,
  result_home,
  result_opp,
  first_server,
  players,
  finalized_sets,
  is_swapped,
  created_at
FROM matches;

DROP TABLE matches;
ALTER TABLE matches_new RENAME TO matches;

CREATE INDEX idx_matches_date ON matches(date);

-- Each record stores the scores and timeout usage for a single set.
CREATE TABLE match_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  set_number INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 5),
  home_score INTEGER,
  opp_score INTEGER,
  home_timeout_1 INTEGER NOT NULL DEFAULT 0 CHECK (home_timeout_1 IN (0, 1)),
  home_timeout_2 INTEGER NOT NULL DEFAULT 0 CHECK (home_timeout_2 IN (0, 1)),
  opp_timeout_1 INTEGER NOT NULL DEFAULT 0 CHECK (opp_timeout_1 IN (0, 1)),
  opp_timeout_2 INTEGER NOT NULL DEFAULT 0 CHECK (opp_timeout_2 IN (0, 1)),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  UNIQUE (match_id, set_number)
);

COMMIT;
