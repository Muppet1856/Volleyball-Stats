// src/utils/init.ts
export function initMatchTable(sql: any): string {
  // Check if table exists before creating
  const cursor = sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='matches';");
  const exists = cursor.toArray().length > 0;
  
  if (!exists) {
    sql.exec(`
      CREATE TABLE matches (
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
    `);
  }
  
  return exists ? "Matches table already exists." : "Matches table created.";
}

export function initPlayerTable(sql: any): string {
  // Check if table exists before creating
  const cursor = sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='players';");
  const exists = cursor.toArray().length > 0;
  
  if (!exists) {
    sql.exec(`
      CREATE TABLE players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL,
        last_name TEXT NOT NULL,
        initial TEXT DEFAULT '',
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
  }
  
  return exists ? "Players table already exists." : "Players table created.";
}

export function initSetTable(sql: any): string {
  // Check if table exists before creating
  const cursor = sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='sets';");
  const exists = cursor.toArray().length > 0;
  
  if (!exists) {
    sql.exec(`
      CREATE TABLE sets (
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
    `);
  }
  
  return exists ? "Sets table already exists." : "Sets table created.";
}