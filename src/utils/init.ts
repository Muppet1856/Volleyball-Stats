// src/utils/init.ts
export function initMatchTable(sql: any): string {
  // Check if table exists before creating
  const cursor = sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='matches';");
  const exists = cursor.toArray().length > 0;
  
  if (!exists) {
    sql.exec(`
      CREATE TABLE matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,  --  The date of the match
        location TEXT,  --  The location of the match
        types TEXT,  --  A JSON of the radio selectors - Tournament, League, Post-Season, Non-League
        opponent TEXT,  --  The name of the opposing team
        jersey_color_home TEXT,  --  An enumeration of the colors - White, Grey, Black, Yellow, Orange, Red, Green, Blue, Purple, Pink
        jersey_color_opp TEXT,  --  An enumeration of the colors - White, Grey, Black, Yellow, Orange, Red, Green, Blue, Purple, Pink
        result_home INTEGER,  --  This is the number of sets where the home team had the higher score and was finalized
        result_opp INTEGER,  --  This is the number of sets where the opposing team had the higher score and was finalized
        first_server TEXT,  --  This is the name of the team who served first
        players TEXT,  --  This is a JSON of the players appearing in the match.  player_id, appeared.
        temp_numbers TEXT,  --  JSON of temp numbers { player_id, temp_number }
        finalized_sets TEXT,  --  this is a JSON of which sets are finalized.
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
  }

  if (exists) {
    const columns = sql.exec("PRAGMA table_info(matches);").toArray();
    const hasDeletedColumn = columns.some((column: any) => column?.name === "deleted");
    const hasTempNumbersColumn = columns.some((column: any) => column?.name === "temp_numbers");
    if (!hasDeletedColumn) {
      sql.exec("ALTER TABLE matches ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;");
    }
    if (!hasTempNumbersColumn) {
      sql.exec("ALTER TABLE matches ADD COLUMN temp_numbers TEXT;");
      const rows = sql.exec("SELECT id, players FROM matches").toArray();
      rows.forEach((row: any) => {
        const { playersJson, tempNumbersJson } = migratePlayersToTempNumbers(row.players);
        sql.exec(
          "UPDATE matches SET players = ?, temp_numbers = ? WHERE id = ?",
          playersJson,
          tempNumbersJson,
          row.id,
        );
      });
    }
  }

  return exists ? "Matches table already exists." : "Matches table created.";
}

function migratePlayersToTempNumbers(playersRaw: any) {
  let parsed: any[] = [];
  try {
    parsed = typeof playersRaw === "string" ? JSON.parse(playersRaw) : playersRaw;
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    parsed = [];
  }

  const players: any[] = [];
  const tempNumbers: any[] = [];

  parsed.forEach((entry) => {
    const playerId = entry?.player_id;
    if (typeof playerId !== "number") return;

    const appeared = entry?.appeared;
    players.push(appeared === undefined ? { player_id: playerId } : { player_id: playerId, appeared: !!appeared });

    const temp = entry?.temp_number ?? entry?.tempNumber;
    const parsedTemp = temp === null || temp === undefined || temp === "" ? null : Number(temp);
    if (parsedTemp !== null && Number.isFinite(parsedTemp)) {
      tempNumbers.push({ player_id: playerId, temp_number: parsedTemp });
    }
  });

  return {
    playersJson: JSON.stringify(players),
    tempNumbersJson: JSON.stringify(tempNumbers),
  };
}

export function initPlayerTable(sql: any): string {
  // Check if table exists before creating
  const cursor = sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='players';");
  const exists = cursor.toArray().length > 0;
  
  if (!exists) {
    sql.exec(`
      CREATE TABLE players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number INTEGER NOT NULL,
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
