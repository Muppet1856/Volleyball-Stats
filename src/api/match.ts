// src/api/match.ts (updated with responses.ts import and usage)
import { jsonSuccess, textResponse, errorResponse, jsonResponse } from "../utils/responses";  // Add this import

export async function createMatch(sql: any, request: Request): Promise<Response> {
  const body = await request.json();  // Expect JSON: { date: "...", location: "...", ... }
  if (body) {
    sql.exec('BEGIN;');
    try {
      sql.exec(`
        INSERT INTO matches (date, location, types, opponent, jersey_color_home, jersey_color_opp, result_home, result_opp, first_server, players, finalized_sets, is_swapped)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, body.date || null, body.location || null, body.types || null, body.opponent || null, body.jersey_color_home || null, body.jersey_color_opp || null, body.result_home || 0, body.result_opp || 0, body.first_server || null, body.players || null, body.finalized_sets || null, body.is_swapped || 0);
      const newId = sql.exec(`SELECT last_insert_rowid()`).toArray()[0][0];
      sql.exec('COMMIT;');
      return jsonSuccess({ id: newId }, 201);  // Updated with responses.ts
    } catch (error) {
      sql.exec('ROLLBACK;');
      return errorResponse("Error creating match: " + (error as Error).message, 500);  // Updated with responses.ts
    }
  } else {
    return errorResponse("No body provided", 400);  // Updated with responses.ts
  }
}

export async function setLocation(sql: any, matchId: number, location: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET location = ? WHERE id = ?`, location, matchId);
    sql.exec('COMMIT;');
    return textResponse("Location updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating location: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setDateTime(sql: any, matchId: number, date: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET date = ? WHERE id = ?`, date, matchId);
    sql.exec('COMMIT;');
    return textResponse("Date updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating date: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setOppName(sql: any, matchId: number, opponent: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET opponent = ? WHERE id = ?`, opponent, matchId);
    sql.exec('COMMIT;');
    return textResponse("Opponent name updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating opponent name: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setType(sql: any, matchId: number, types: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET types = ? WHERE id = ?`, types, matchId);
    sql.exec('COMMIT;');
    return textResponse("Type updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating type: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setResult(sql: any, matchId: number, resultHome: number, resultOpp: number): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET result_home = ?, result_opp = ? WHERE id = ?`, resultHome, resultOpp, matchId);
    sql.exec('COMMIT;');
    return textResponse("Result updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating result: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setPlayers(sql: any, matchId: number, players: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET players = ? WHERE id = ?`, players, matchId);
    sql.exec('COMMIT;');
    return textResponse("Players updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating players: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setHomeColor(sql: any, matchId: number, jerseyColorHome: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET jersey_color_home = ? WHERE id = ?`, jerseyColorHome, matchId);
    sql.exec('COMMIT;');
    return textResponse("Home jersey color updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating home jersey color: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setOppColor(sql: any, matchId: number, jerseyColorOpp: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET jersey_color_opp = ? WHERE id = ?`, jerseyColorOpp, matchId);
    sql.exec('COMMIT;');
    return textResponse("Opponent jersey color updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating opponent jersey color: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setFirstServer(sql: any, matchId: number, firstServer: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE matches SET first_server = ? WHERE id = ?`, firstServer, matchId);
    sql.exec('COMMIT;');
    return textResponse("First server updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating first server: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function getSets(sql: any, matchId: number): Promise<Response> {
  const cursor = sql.exec(`SELECT * FROM sets WHERE match_id = ?`, matchId);
  const rows = cursor.toArray();
  return jsonResponse(rows);  // Updated with responses.ts
}

export async function getMatches(sql: any): Promise<Response> {
  const cursor = sql.exec(`SELECT * FROM matches`);
  const rows = cursor.toArray();
  return jsonResponse(rows);  // Updated with responses.ts
}